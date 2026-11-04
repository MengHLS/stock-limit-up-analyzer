# RESEARCH-006.0 — Research → Strategy Candidate/Draft 架构审计与接口设计

> **性质**：架构审计 + 接口设计。**不实施链路**，不改 schema、不写 migration、不改现有业务行为、不碰 Dataset Registry。
> **证据等级**：全部结论以**当前源码 + 真实 TiDB 只读实查**为准（探针 `docs/evidence/_r006_probe.mjs` → `docs/evidence/_r006_probe_result.md`）。凡旧报告写过而代码中没有的能力，一律判为不存在。
> **状态**：`RESEARCH-006.0 = COMPLETE`
> **⚠️ 编号提示**：`§47` 已用 `RESEARCH-006 / 007 / 008`（9m/9n/9o）指代**结果页可读性**的前端任务。本 STEP 是**另一个** `RESEARCH-006`（架构线），故一律带 `.0/.1/...` 子号以示区分；后续若继续走架构线，建议在 §47 中统一标注「架构线」前缀，避免两条线互相冒充。

---

## 1. 当前真实架构

### 1.1 三个模块的真实坐标

| 模块 | 代码位置 | 领域对象归属 | 持久化 | 真实行数（2026-09-12 实查） |
| --- | --- | --- | --- | --- |
| Dataset Registry | `server/datasetRegistry/` | `dataset_definition` / `dataset_version` / `dataset_build_job` | Drizzle + TiDB | 1 / 2（**均 READY**）/ 4 |
| Research（新，单数） | `server/researchCore/` + `server/researchEngine/` | `research_*` 12 表 | `researchCore/repository/db.ts` | 见 §2.1 |
| Research（legacy，复数） | `server/research/`（`types.ts` / `experiment.ts` / `run.ts` …） | `research_experiments` / `_runs` / `_datasets` | 独立 | 与本次无关，**零引用** |
| Strategy | `server/research/strategySchema/` + `strategyPersistence/` + `server/strategy/`（legacy） | `strategies` / `strategy_versions` / 5 张投影 | `DbStrategyRepository` | **全 0 行** |

### 1.2 两条容易混淆的「复数/单数」链路

- **单数（新，Dataset-Registry 原生）**：`research_experiment`（`datasetVersionId` bigint 驱动）→ `research_hypothesis` / `research_run` → `research_analysis`（+ condition/metric）→ `research_result` → `research_conclusion` → `research_strategy_candidate`。
- **复数（legacy，STEP 6.x）**：字符串 `experimentId` + `strategyId` 驱动 + 单一大 `snapshotJson`。**两套仅差一个 `s`、互不引用**，`server/researchCore/types.ts` 头部注释已明确消歧。
- 本报告的一切结论**只针对单数链路**。

### 1.3 Strategy 侧的真实三层（STRATEGY-002 / 003 / 004 后）

```
strategies（业务身份 strategyId varchar(64) UNIQUE + currentVersionId 权威版本指针）
      ↓ 1:N
strategy_versions（**Canonical SoT**：strategyDocumentJson 内含 rich definition）
      ↓ 单向派生（同一事务）
5 张投影表：strategy_parameters / _entry_rules / _exit_rules / _execution_rules / _version_datasets
```

---

## 2. Research 领域对象现状

### 2.1 现状表

| 对象 | 当前是否存在 | DB 表 | 核心字段 | 生命周期 | 谁创建 | 谁修改 | 真实行数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Experiment** | ✅ | `research_experiment` | `datasetVersionId`（**创建即冻结**）、`researchType`、`status`、`configJson` | `DRAFT/READY/RUNNING/COMPLETED/FAILED/ARCHIVED` | tRPC `createExperiment`（admin） | `updateExperiment`（白名单，**无 `datasetVersionId` 键**） | 2（全 COMPLETED） |
| **Hypothesis** | ✅ | `research_hypothesis` | `experimentId`、`statement`、`status` | `DRAFT/TESTING/SUPPORTED/PARTIALLY_SUPPORTED/REJECTED/INCONCLUSIVE` | tRPC `createHypothesis` | `updateHypothesis` | **0** |
| **Run** | ✅ | `research_run` | `experimentId`、`runNo`（`UNIQUE(experimentId,runNo)`）、`inputSnapshotJson`（**冻结基准**）、`executionLogJson`（**追加式**）、`status` | `PENDING/RUNNING/COMPLETED/FAILED/CANCELLED` | tRPC `createRun`（**只建不执行**）/ `runEngine` / `runIncremental` | 引擎写 status + 追加日志 | 8（7 COMPLETED / 1 FAILED） |
| **Analysis** | ✅ | `research_analysis`（+ `_condition` / `_metric`） | `runId`、`analysisType`（**10 类**含 `SEGMENT_RELATION`）、`target`、`configJson` | `PENDING/RUNNING/COMPLETED/FAILED/CANCELLED` | tRPC `createAnalysis` / `createAnalyses`（批量）/ `applyAnalysisTemplate` | `updateAnalysis`（**name/target/config/status**） | 19（18 COMPLETED / 1 PENDING） |
| **Result** | ✅ | `research_result` | `analysisId`、`metricCode`、`metricValue`、`sampleCount`、`resultType`、`dimensionJson`、`resultJson` | **无独立状态**；随 Analysis 重算被替换 | 引擎 `results.createMany` | 🔴 `results.deleteByAnalysis` + 重建（**非 immutable**，见 §4.2） | **674** |
| **Conclusion** | ✅ **真实存在** | `research_conclusion` | `experimentId`（必填）、`hypothesisId`（可空）、`conclusionType`、`title`、`conclusion`、`evidenceJson`、`confidence`、`status` | `DRAFT/FINAL/SUPERSEDED`（**当前 7 行全 DRAFT**） | 🔴 **引擎自动生成**（`researchEngine/engine.ts:311` → `conclusion.ts#buildConclusion`，规则式策略）。**无 create/update 端点** | 无产品级修改入口；仅维护层级联删除 | **7**（5 SUPPORTED / 2 PARTIALLY_SUPPORTED） |
| **StrategyCandidate** | ✅ 表存在，**写入位空** | `research_strategy_candidate` | `experimentId`（必填）、`conclusionId`（可空）、`strategyDefinitionId`（varchar，**NULL = 未转正**）、`name`、`description`、`entryRuleJson`/`filterRuleJson`/`exitRuleJson`/`riskRuleJson`/`parameterSpaceJson`、`status` | `DRAFT/REVIEW/ACCEPTED/REJECTED/CONVERTED/ARCHIVED`（机读迁移表已实现于 `researchCore/candidates.ts`） | 🔴 **无任何写入路径**（`create`/`update` 在 Repository 契约中已定义但**代码零调用**） | 仅维护层级联删除 | **0** |
| Artifact | ✅ | `research_artifact` | `experimentId`/`runId`（至少一非空）、`uri` + `checksum` | — | 无入口 | — | 0 |
| AnalysisTemplate | ✅ | `research_analysis_template`(+`_item`) | `name`（全局唯一）、明细 `sortOrder` | — | tRPC `createAnalysisTemplate` | `deleteAnalysisTemplate` | 0 |

### 2.2 逐项确认（指令 §3.1~§3.4）

- **3.1 Analysis**：定义落 `research_analysis`（`configJson` 开放扩展）+ `research_analysis_condition`（**结构化**关系表，组内 `logicalOperator` / 组间 `groupLogicalOperator` / 组内 `sortOrder`）+ `research_analysis_metric`。**Feature / target / horizon / grouping / filters 一律经 `configJson` + 条件表表达**，没有独立列。Dataset **不在 Analysis 上**——它挂在 Experiment。Analysis **允许修改**（`updateAnalysis` 白名单含 `config`）；`setAnalysisConditions` 是**唯一**会「让旧产物失效」的路径（替换条件 → 删旧结果 → 删失效结论 → Analysis/Run 回退 `PENDING`）；⚠️ **`updateAnalysis` 改 `config` 不失效旧结果**（真实缺口，见 §4.2）。
- **3.2 Run**：Run ∈ Experiment（1:N，`(experimentId, runNo)` 唯一）。**Run 本身不绑 Dataset Version**，坐标在 `inputSnapshotJson` 内（`readSnapshotBasis` 断言 `basis.datasetVersionId === experiment.datasetVersionId`，否则 `DATASET_VERSION_DRIFT`）。快照 = **首次整轮执行时冻结、事后不得修改**；增量执行的事实另落**追加式** `executionLogJson`（`sequence` 单调不跳号、**不 backfill**）。可重复执行（`PENDING|FAILED|CANCELLED` 可重跑；`COMPLETED` 只能增量补跑）。有状态、有失败态（`FAILED` + `errorCode`/`errorMessage`）。
- **3.3 Result**：Result 是**单次执行产物**（`analysisId` 外键），**不是** Analysis 的长期累积。保存原始统计结果（`metricValue` 结构化 / `resultJson` 扩展）。**不保存参数、不保存 Dataset 坐标**（0 个 dataset 相关列，实查确认）。可被**多个 Conclusion 引用**（`evidenceJson` 里可列 `primaryAnalysis` + `contributingAnalyses`）。
- **3.4 Conclusion**：**存在于 DB、schema、API（只读 `listConclusions`）、Repository、领域类型**六处；**但产品级「创建」入口不存在** —— 全部 7 行由引擎规则式生成。**不可编辑、无状态变更端点**（`status` 列存在但无写入路径）。与 Result 的关系：**只有 `evidenceJson` 的 JSON 引用**（`primaryAnalysis.analysisId` ∪ `contributingAnalyses[].analysisId` ∪ 旧键 `analyses[].analysisId`），**无关系表、无列**。

```
RESEARCH_CONCLUSION = IMPLEMENTED（表 / schema / 类型 / 只读 API / 领域校验均存在）
                    但 CREATE/UPDATE = NOT IMPLEMENTED（仅引擎规则式生成；无人工创建与编辑入口）
```

---

## 3. Strategy 领域对象现状

### 3.1 StrategyDefinition

- **是 Canonical SoT 吗？** 是——但**不是独立表**：它是 `StrategyDocument.definition` 这个**内嵌字段**，落地在 `strategy_versions.strategyDocumentJson`（唯一 SoT 铁律见 `drizzle/schema.ts:584-591` 与 `strategySchema/definition.ts` 头部）。**禁止**新建第二套 SoT。
- **如何创建**：`StrategyService.create()` / `save()`（tRPC `research.strategy.create` / `save`，**adminProcedure**）；`createStrategyDocument(input)` 在提供 `definition` 时**自动派生** v1 兼容视图（`entryRules`/`exitRules`/`riskRules`/`positionSizing`/`parameters`/`executionModel`），显式提供且冲突 → `SCHEMA_DEFINITION_VIEW_CONFLICT`（响亮失败，不静默覆盖）。
- **如何保存**：`DbStrategyRepository.saveVersion()` —— **canonical + 5 投影 + 指纹在同一事务**；Dataset 引用校验（`assertStrategyDatasetBindings`）**也在该事务内**。
- **如何生成 Version**：`createVersion()`（复用 `bumpStrategyVersion` / `classifyRequiredBumpKind` 语义闸门）。
- **如何 Clone**：`cloneVersion()` —— 可从**任意历史版本** clone（不限于 latest），`parentVersionId` 指向源版本行 id。
- **如何 Validate**：`validateVersion()`（读，public）+ `strategySchema/validate.ts`（结构化 issue）+ `definitionValidation.ts`（**Look-Ahead 静态 8 规则 L1–L8**，字段时间域目录 + 白名单，时间语义不明**默认拒绝**）。
- **如何改 Status**：`setVersionStatus()` —— 只接受 C-21.1 八态；**内容仍不可变**（同 `version` 同内容 = `idempotent-skip`，不同内容 = `conflict`，**绝不覆盖**）。

### 3.2 Strategy Version

`strategies` 1:N `strategy_versions`（`UNIQUE(strategyId, version)`）。

| 字段 | 语义 | 可变性 |
| --- | --- | --- |
| `version` | 严格 semver `major.minor.patch` | 不可变 |
| `status` | **C-21.1 八态** `Draft/Research/Candidate/Validated/Paper/Approved/Production/Retired`，默认 `Draft` | 🔴 **唯一可 UPDATE 的列** |
| `parentVersionId` | 源版本 → `strategy_versions.id`（软引用，无 FK） | 写入即定 |
| `strategyDocumentJson` | Canonical（含 `definition`） | **不可变**（改内容 = 新建版本） |
| `versionRecordJson` | §17 九项追溯快照（`parameterSet`/`backtestConfig`/`costModel`/`executionModel`/`codeVersion`/`createdAt`） | **不可变** |
| `datasetVersionId` | **跨模块唯一 Dataset 坐标** = `dataset_version.id` | 不可变 |
| `datasetVersion` | label / 快照（`v1`/`v2`；legacy 为 `rd-…`） | 不可变 |
| `fingerprint` | 文档级内容指纹（幂等 / 不可变判定键） | 不可变 |
| `universeId` / `codeVersion` / `description` / `createdAt` / `updatedAt` | — | `description` 随写入；`updatedAt` 仅表状态迁移时间 |

5 张投影（`parameters` / `entry_rules` / `exit_rules` / `execution_rules` / `version_datasets`）**只读派生**，漂移由 `projection.ts#verifyStrategyProjections` 报 `SCHEMA_DEFINITION_VIEW_DRIFT`，**绝不自动修复**。

### 3.3 Dataset Binding（STRATEGY-004 后）

| 字段 | 语义 | 唯一权威 |
| --- | --- | --- |
| `datasetVersionId` | **PRIMARY 跨模块唯一坐标** = `dataset_version.id`（bigint，软引用，无 FK） | ✅ **跨模块唯一引用** |
| `datasetVersion` | label / 快照（`v1`/`v2`）；legacy 为 `rd-…` | 显示与快照，**非引用** |
| `datasetId` | `dataset_definition.datasetCode`（如 `first_limit_pullback`） | Registry 业务码 |
| `role` | `PRIMARY` / `VALIDATION` / `OOS` | — |
| `ordinal` | 投影内顺序（canonical 内按 `(role, datasetId, datasetVersion, datasetVersionId)` 确定性排序） | 派生 |

**结论（不接受任何替代方案）**：

```
datasetVersionId = dataset_version.id   ← 唯一跨模块 Dataset 坐标
```

引用完整性唯一实现 = `server/research/strategyPersistence/datasetBindingValidation.ts`；判据 = **存在 ∧ `status === "READY"` ∧ label == Registry `version` ∧ `datasetId` 属于该版本**；错误码 `DATASET_VERSION_NOT_FOUND` / `DATASET_VERSION_NOT_READY` / `DATASET_BINDING_INVALID`；**在 `db.ts#saveVersion` 事务内**执行。**禁**第二套 Dataset Version ID、**禁**复制 Registry 版本表、**禁**绕过 Registry 直读 `ds_*`。

### 3.4 ⚠️ 现存的三种「Candidate」语义（必须在设计前说清）

| # | 载体 | 位置 | 语义 | 状态 |
| --- | --- | --- | --- | --- |
| ① | `research_strategy_candidate`（**表**） | Research 侧 | 「由研究结论导出的待审策略草图」 | **0 行，无写入路径** |
| ② | `Candidate`（**状态值**） | `server/research/lifecycle/types.ts:63` | C-21.1 八态中第 3 态（`Draft→Research→Candidate→…`） | 只由 `STRATEGY_LIFECYCLE_STATUSES` 携带 |
| ③ | `research.lifecycle.transition`（**无状态纯函数**） | `researchRouter.ts:239` | 客户端把 `record` 传进来、服务端算出新 record 返回，**不落库** | 与 `strategies.status` 列无绑定 |

⇒ 本设计**不新建第四种**。① 承担「Research→Strategy 的桥」，② 承担「Strategy Version 的成熟度」，③ 保持现状。

---

## 4. 当前断点（附代码坐标）

### 4.1 主断点：桥已建好，但两头都没接线

| 断点 | 证据 | 后果 |
| --- | --- | --- |
| **B1 · Candidate 无写入路径** | `researchCore/repository/contract.ts:219-225` 完整定义了 `create/getById/list/update/delete`；全库唯一用到 `candidates.*` 的是 `maintenance.ts` 的 `list` / `delete`；`candidates.create` **零调用点** | 表 0 行；`CandidatesPanel.tsx` 只能常年显示「为什么空」 |
| **B2 · Conclusion 无人工创建 / 编辑入口** | 只有 `listConclusions`（public）；`engine.ts:311` 是唯一 `create` 调用；无 `createConclusion` / `updateConclusion` 端点 | 结论的 `status` 永远停在引擎写入时的值（实测 7 行全 `DRAFT`），无法「定稿」 |
| **B3 · Candidate 与 Strategy 零连接** | `strategyDefinitionId` 有索引（`idx_research_candidate_strategy`）但无写入者；`strategy_versions` 真实列实查 **无任何 research 列** | 无法回答「这个 Strategy 从哪个 Research 来」 |
| **B4 · Strategy 侧零 provenance 载体** | `strategy_versions` 实查列：`id, strategyId, version, strategyDocumentJson, versionRecordJson, fingerprint, datasetVersion, universeId, codeVersion, createdAt, parentVersionId, status, description, updatedAt, datasetVersionId` | 即使 Research 侧记了，Strategy 侧也答不出 |
| **B5 · Candidate 不存 Dataset 坐标** | 实查：`research_result` / `research_analysis` / `research_run` **零 dataset 相关列**；坐标只在 `research_experiment.datasetVersionId` | 坐标只能经 `candidate → experiment` 一跳派生；实验一旦级联删除即丢 |
| **B6 · 生命周期无持久化绑定** | `research.lifecycle.transition` 是无状态纯函数；`strategies.status` 列存在但「由 lifecycle 层维护、本层只透传」 | 版本状态**能**落库（`setVersionStatus`），但八态迁移**没走同一入口**，存在两套「状态真相」 |

### 4.2 Research 是否已具备成为上游的资格（指令 §19）

| 检查项 | 判定 | 证据 |
| --- | --- | --- |
| **A. Result 是否 immutable** | ❌ **不是** | `engine.ts:712-714`：`if (this.resetExistingResults) await results.deleteByAnalysis(id); await results.createMany(rows)` ⇒ **重算即替换**。`setAnalysisConditions` 亦主动删旧结果。⇒ **Result 不能作为 provenance 锚点** |
| **B. Conclusion 是否真正存在** | ✅ **存在**（非 NOT IMPLEMENTED）；但**只有机器生成**，无人工创建/编辑/定稿 | §2.2 / §4.1 B2 |
| **C. Result 是否含完整分析上下文** | ⚠️ **部分缺失**：有 `metricCode`/`metricValue`/`sampleCount`/`dimensionJson`/`resultJson`；**缺** Dataset Version、Analysis Config、Run Config、feature/target/horizon/filter 的**结构化**落库（这些在 `research_analysis.configJson` 与 `research_run.inputSnapshotJson` 里，需两跳回查）。**无内容指纹、无版本号** | 实查 §2.1 |
| **D. 是否允许改历史结果** | 🔴 **允许**（重跑覆盖 + 条件替换即失效）。**当前无 snapshot / fingerprint / version 机制** | 同 A |
| **E. Conclusion → Run 是否可列级反查** | ❌ **不能**。`research_conclusion` **无 `runId`**（只有 `experimentId` / `hypothesisId`）。要拿 Run 必须走 `evidenceJson.primaryAnalysis.analysisId → research_analysis.runId` **两跳 JSON 解析**，且 `evidence` 里可能**提不出 id**（维护层已为此设 `unattributed` 计数并**绝不删**） | §2.2；`maintenance.ts:138-151` |
| **F. 级联删除会毁桥** | 🔴 是 | `deleteExperimentCascade` 会**连 candidate 一起删**（`maintenance.ts` 的 candidate 循环）⇒ 若 Strategy 的溯源只存在 Research 侧，**清理研究即永久失去溯源** |

**结论**：Research **已具备**成为上游的**数据资格**（有结论、有证据、有 Dataset 坐标），但**不具备**作为**唯一溯源载体**的资格（Result 可变、链路靠 JSON 反推、级联删除会毁桥）。⇒ 设计必须把**溯源快照写到 Strategy 侧**。

---

## 5. Candidate / Draft 方案比较

### 5.1 三方案

| 维度 | **方案 A**<br>Conclusion → Draft → Version | **方案 B**<br>Conclusion → Candidate → Draft → Version | **方案 C**<br>Conclusion → Candidate（=Draft）→ Version |
| --- | --- | --- | --- |
| 需要新建的对象 | `strategy_drafts` 表 + 服务 | `strategy_drafts` 表 + 服务（**在 A 之上再加一层**） | **无**（`research_strategy_candidate` 已存在） |
| 生命周期清晰度 | 差：「Draft」既是对象又是状态 | 差：三层对象（Candidate/Draft/Version），状态词与 C-21.1 的 `Draft`/`Candidate` **同名不同物** | ✅ 好：Candidate 管「研究→策略的取舍」，C-21.1 管「策略成熟度」，**互不重叠** |
| 用户交互 | 研究结论 → 直接落到 Strategy 编辑器 | 4 次交接，每次都要解释「这跟上一个有什么区别」 | ✅ 2 次交接（登记候选 / 转正） |
| 可编辑性 | Draft 表可编辑 → 与「内容不可变」冲突 | 同 A，且 Candidate 也要可编辑 = 两处可编辑 | ✅ Candidate 可自由编辑（它**不是** canonical）；Strategy Version 仍严格不可变 |
| 审计追踪 | provenance 只有一处（Draft） | provenance 分散两层，需逐层比对 | ✅ provenance 单一来源 = Candidate + 转正时的 Strategy 侧快照 |
| 多 Candidate / 一 Conclusion | 不表达 | 可表达（但两层都可多 = 组合爆炸） | ✅ 可表达（1:N 自然） |
| N Conclusion → 1 Candidate | 难 | 难 | ✅ 用「人写一份草图」实现（见 §5.3） |
| 是否污染 Strategy Canonical SoT | ⚠️ Draft 若是第二份可执行定义 ⇒ **污染** | 🔴 **严重污染**（两份） | ✅ **不污染**（Candidate 的规则草图文案**不合法于** Strategy 词表，见 §5.2） |
| 数据库复杂度 | +1 表 | +2 表 | ✅ **0 新对象表**（仅 +1 provenance 表，与方案无关，见 §8） |
| API 复杂度 | 中 | 高 | ✅ 低（6 端点） |
| Backtest 兼容性 | Draft 需再转 Version，多一跳 | 多两跳 | ✅ Candidate 只需产出合法 `StrategyDefinition`，与 Backtest 零耦合 |

### 5.2 Candidate 的规则草图与 Strategy Definition 是**两套词表**（关键论证）

现有 `research_strategy_candidate` 的列（`entryRuleJson` 等）承载的是 `researchCore/candidates.ts` 的**Research 侧草图**：

```ts
ResearchEntryRule  { event?: string; timing?: string }        // 自由字符串
ResearchExitRule   { holdingDays?: number; takeProfit?: number; stopLoss?: number }
ResearchRiskRule   { maxPositions?: number; regimeGate?: ResearchConditionSet }
```

而 `StrategyDefinition` 是**强类型词表 + 时间域目录 + Look-Ahead 静态校验**：

```ts
entry.event.type ∈ {FIRST_LIMIT_UP, LIMIT_UP, BREAKOUT, PRICE_PATTERN, CUSTOM_EVENT}
entry.conditions[].field 必须可被 parseStrategyFieldReference 解析（prefix.rd0.open / event.limitUpPrice / bar.low / …）
entry.trigger.type ∈ {FIRST_VALID_DAY, LAST_VALID_DAY, EVERY_VALID_DAY, NEXT_TRADING_DAY}
exit.rules[].type ∈ {TAKE_PROFIT, STOP_LOSS, TIME_EXIT, SIGNAL_EXIT, FORCED_EXIT}
```

⇒ **两者不可能同构**。若强行让 Candidate 直接存 `StrategyDefinition`，就必须在 Candidate 侧再实现一套 `validate` 与字段时间域判定 ⇒ 第二 Canonical（§25 禁止 4）与两套口径（违反「同一口径唯一权威」的项目铁律）。

### 5.3 最终选择

```
推荐方案：C
```

理由（按优先级）：

1. **它是唯一不新增领域对象的方案**：`research_strategy_candidate` 表、机读状态机（`CANDIDATE_TRANSITIONS`）、`assertCandidateTransition` / `assertCandidateConversionCoherence`、Repository 契约**全部已存在且实现完整**（`contract.ts` + `db.ts` + `inMemory.ts`），缺的只是**调用点**。另两个方案都要从零建表 + 建服务。
2. **它把「谁管什么」分得最干净**：Candidate 管 *研究发现的取舍*（可编辑、可多份、可作废），C-21.1 `status` 管 *策略版本的成熟度*（不可变内容 + 唯一可变列）。A/B 会让「Draft」同时是对象与状态，与既有八态**直接撞名**。
3. **它对 Canonical SoT 零污染**：Candidate 存的是**研究意图草图**，转正时经**显式转换器**产出 `StrategyDefinition` 并强制 `validate`。
4. **它自然支持 1:N**：同一结论可导出多份候选（不同出场设计 / 不同参数取向）；**N:1 合并**则由「人把多个发现写进同一份草图」实现——合并是**研究判断**问题，不是数据结构问题，用 N 条 FK 表达反而是把判断伪装成结构。
5. **它与 Backtest 完全解耦**：Candidate 不参与任何执行路径。

**明确拒绝的两个变体**：

- ❌ `Conclusion → 自动创建 Strategy Version`（§25 禁止 2）：绕过人的取舍边界，且与「Candidate 不是 canonical」冲突。
- ❌ `research_result.strategyVersionId`（§25 禁止 1）：Result 本身**可变**（§4.2 A），拿它做锚点等于把溯源挂在一个会被覆盖的行上。

---

## 6. 最终推荐架构

```
Dataset Registry（dataset_version.id 为唯一坐标）
        ▲
        │ 只读引用（既有 datasetBindingValidation，事务内校验）
        │
   ┌────┴─────────────────────────────────────────────┐
   │                                                  │
Research（发现层）                              Strategy（规则定义层）
   │                                                  ▲
   experiment ── datasetVersionId（创建即冻结）        │
   run ── inputSnapshot（冻结基准）                    │
   analysis ── configJson                             │
   result ── 可变（重算覆盖）                          │
   conclusion ── evidence（analysisId 引用）           │
        │                                             │
        │  「登记候选」（人的动作 ①）                   │
        ▼                                             │
   research_strategy_candidate ───────────────────────┘
        │（EXIT：researchCore 不写任何 strategy_* 表）   「转正 / promote」（人的动作 ②）
        │                                             │
        └─────► StrategyCandidateService.promote ─────► build StrategyDefinition
                                                       ↓ validate（L1–L8）
                                                       ↓ Dataset Registry 校验（同事务）
                                                       ↓ StrategyService.create + createVersion
                                                       └─► strategies
                                                           strategy_versions（status=Draft|Research）
                                                           + 5 投影
                                                           + strategy_research_provenance（溯源快照）
```

**人机边界（唯一且强制）**：

```
Research Result / Conclusion ──✗──► 直接修改 StrategyDefinition / 覆盖已有 Strategy Version
Research Conclusion ──「登记候选」──► Candidate ──「转正」──► Strategy Version
```

**依赖方向（单向，禁环）**：

```
researchCore  ←── 不认识 Strategy 领域（不 import strategySchema / strategyPersistence）
strategyPersistence ←── 不认识 Research（不 import researchCore）
strategyCandidate（新，应用服务）──► 同时依赖两者，是唯一的桥
```

---

## 7. Domain Model

### 7.1 `StrategyCandidate`（Research 侧的桥对象）

| 字段 | 必须/可选/派生/不应存在 | 说明 |
| --- | --- | --- |
| `id` | 必须（DB 生成） | — |
| `experimentId` | **必须** | 已有。Candidate 恒属某 Experiment（承 `datasetVersionId` 的锚） |
| `conclusionId` | **必须**（业务上；列为 nullable 以兼容历史） | 已有。**这是桥的唯一入口**。006.2 起 `createFromConclusion` 恒填 |
| `strategyDefinitionId` | **转正后必须、之前必须为 NULL** | 已有。`assertCandidateConversionCoherence` 已强制该耦合 |
| `name` / `description` | 必须 / 可选 | 已有 |
| `entryRuleJson` / `filterRuleJson` / `exitRuleJson` / `riskRuleJson` | 可选 | 已有。**研究意图草图**（Research 词表，非 Strategy 词表） |
| `parameterSpaceJson` | 可选 | 已有。**交 Parameter Search 的待搜空间**（Research 只声明、不搜索） |
| `status` | 必须（默认 `DRAFT`） | 已有 |
| `sourceDatasetVersionId` | **必须新增** | 研究**来源**坐标快照（写入时从 `experiment.datasetVersionId` 复制，之后**不随上游变化**） |
| `sourceResearchRunId` | **必须新增（可空）** | `evidence.primaryAnalysis.analysisId → research_analysis.runId`；**提不出即为 NULL，不伪造** |
| `sourceTraceJson` | 必须新增（可空） | 细粒度证据快照（`analysisId` / `metricCode` / `effectLabel` / `disclaimer` 摘要），供 UI 显示「凭什么」 |
| `sourceDatasetDivergenceReason` | 必须新增（可空） | **仅当**转正时策略绑定了**不同** Dataset Version 时才写；无差异必须为 NULL（防止「填了就显得严肃」的空话） |
| `strategyVersion` / `boundAt` | ❌ **不应存在** | 转正细节归 `strategy_research_provenance`（Strategy 侧），不在 Research 侧留第二份 |
| `datasetId` / `datasetVersion`（label） | ❌ **不应存在** | label 可由 `sourceDatasetVersionId` 实时查 Registry 得到；落列 = 第二份会漂移的副本 |
| 完整 `StrategyDefinition` | ❌ **不应存在** | 见 §5.2：两套词表不可能同构；存了就是第二 Canonical |

### 7.2 `StrategyResearchProvenance`（Strategy 侧的溯源快照，**新对象**）

| 字段 | 说明 |
| --- | --- |
| `strategyVersionId` | 权威行锚 → `strategy_versions.id`（`UNIQUE`） |
| `strategyId` / `strategyVersion` | 冗余便于直查（与 5 投影表同风格） |
| `sourceCandidateId` / `sourceConclusionId` / `sourceExperimentId` | 快照值（**不是 FK**），保证上游删除后仍可回答 |
| `sourceResearchRunId` | 可空 |
| `sourceDatasetVersionId` / `sourceDatasetLabel` | 研究**来源**坐标 + 可读 label（快照） |
| `sourceSnapshotJson` | `sourceTraceJson` 的副本（含免责声明摘要） |
| `origin` | `DIRECT`（promote 产出）/ `INHERITED`（clone 继承） |
| `createdAt` | — |

**定位**：**display-only**。不参与 `StrategyDocument` / `definition` / 5 投影 / 指纹 / 校验 / 回测 / 参数搜索的任何读取路径。**即使 Research 模块整个不可用，Strategy Version 仍可 validate / backtest / simulate / execute。**

---

## 8. Provenance

### 8.1 是否四个 id 全存？

**不全存。** 逐项判定（指令 §7.1）：

| 候选字段 | 判定 | 理由 |
| --- | --- | --- |
| `sourceConclusionId` | ✅ **必存** | 唯一入口；且是「结论」这一层语义的最小完备引用 |
| `sourceResearchRunId` | ✅ **必存（可空）** | 🔴 **唯一无法从列级反查的量**（`research_conclusion` 无 `runId`；只能两跳解析 `evidence` JSON）⇒ 不存就永久丢失「跑在哪个执行上」。空值 = 诚实（提不出 id） |
| `sourceResearchAnalysisId` | ⚠️ 存 `sourceSnapshotJson` 内，**不落列** | 可从 `evidence` 现取；且一个结论**可引用多个** analysis（`contributingAnalyses`）⇒ 列化会退化成「只留第一个」的失真 |
| `sourceResearchResultId` | ❌ **不存** | 🔴 Result **可变**（§4.2 A：`deleteByAnalysis` + 重建 ⇒ `id` 整体换新）。存 = 存一个会失效的锚点 |
| `sourceExperimentId` | ✅ 存 | 承 `datasetVersionId` 的锚，且 Cascade 语义需要它 |
| `sourceDatasetVersionId` | ✅ **必存（快照）** | §9 |

**冗余 vs 可追溯的取舍原则**：落列的只保留**「无法廉价回查」或「会随上游消失/变化」**的量；能现取的一律不落列（避免第二份会漂移的副本 —— 与项目「禁第二套 Dataset Version ID」「投影禁反向生成」同一纪律）。

### 8.2 写入时机（三处，一次定死）

| 时机 | 写入内容 |
| --- | --- |
| **登记候选**（`createFromConclusion`） | `research_strategy_candidate` 全行，含 `sourceDatasetVersionId`（从 experiment 复制）+ `sourceResearchRunId`（从 evidence 提取）+ `sourceTraceJson` |
| **转正**（`promote`） | `strategy_research_provenance` 一行（`origin='DIRECT'`），**与 strategy 写入同一事务**（见 §11.3） |
| **clone**（`cloneVersion`） | 复制源版本的 provenance（`origin='INHERITED'`）。**006.3 实现**；在此之前 clone 出的版本无溯源行（显式登记为已知缺口，不静默） |

### 8.3 删除策略（指令 §20）

```
规定：Research = provenance（快照）         Strategy = independent artifact（可独立存活）
```

| 事件 | 设计行为 | 理由 |
| --- | --- | --- |
| 删 Conclusion（现由 Analysis/Hypothesis/Experiment 级联触发） | **Strategy 侧零动作** | provenance 存的是**快照值**，不依赖上游行存在 |
| 删 Experiment（现 `deleteExperimentCascade` **连 candidate 一起删**） | **保持现状不动**（Research 拥有自己的行）；Strategy 侧仍可回答「来源 = conclusion #N / experiment #M / dataset version #K」 | 这就是「快照而非 FK」的全部价值；**不需要** `SOURCE_DELETED` 状态列 |
| 删 Strategy（`deleteStrategy`） | 显式同事务删除该 strategy 全部 provenance 行 | 溯源是关于该策略的，随策略消亡 |
| 删 Dataset Version | **不加 FK ⇒ 不级联**。provenance 里的 `sourceDatasetVersionId` 变悬空 | 应用层读取时**如实标注「来源数据集版本已不存在」**，不伪造、不自动清理（与项目「绝不自动修复漂移」同纪律） |

> ⚠️ 因为**没有任何 FK**，「来源是否仍存在」永远只能在读取时探测。这是项目既有原则的必然代价，**已在设计中显式登记**，不是遗漏。

---

## 9. Dataset 坐标

### 9.1 坐标沿链路的传递

```
dataset_version.id
   │
   ├─► research_experiment.datasetVersionId（**创建即冻结**：ResearchExperimentUpdatePatch 排除该列）
   │        │
   │        ├─► research_run.inputSnapshotJson.datasetVersionId（冻结基准；runIncremental 断言一致，否则 DATASET_VERSION_DRIFT）
   │        │
   │        └─► research_strategy_candidate.sourceDatasetVersionId ← **新增，快照**
   │
   └─► strategy_versions.datasetVersionId / strategy_version_datasets.datasetVersionId
            （PRIMARY 绑定，事务内由 datasetBindingValidation 校验）
```

**唯一口径（不重新设计）**：`datasetVersionId = dataset_version.id`。`datasetVersion`（`v1`/`v2`）**只是 label**。

### 9.2 Research 与 Strategy 允许用不同 Dataset Version 吗？

```
结论：条件允许不同。
```

必须区分两个**语义不同**的量：

| 概念 | 含义 | 载体 |
| --- | --- | --- |
| **Research Source Dataset** | 「这条结论是在哪份数据上算出来的」 | `research_experiment.datasetVersionId` + `candidate.sourceDatasetVersionId` 快照 |
| **Strategy Execution Dataset** | 「这个策略将来在回测/模拟/执行时消费哪份数据」 | `strategy_versions.datasetVersionId`（PRIMARY） |

规则：

1. **缺省 = 继承**：`promote` 不显式给 `datasetBinding` 时，PRIMARY 绑定 = 候选的 `sourceDatasetVersionId`（经 Registry 校验，必须 READY）。⇒ 最常见路径「研究用 v2 → 策略也用 v2」零额外操作。
2. **允许不同，但必须显式且留痕**：
   - 调用方须显式传 `overrides.datasetBinding`，并**必须**同时传 `datasetDivergenceReason`（人可读）。
   - 例如：研究在 `first_limit_pullback v1` 上发现规律，但策略要绑 `v2`（更大窗口）。**这是合法且常见的**——研究验证了机制，执行要覆盖更长历史。
   - **不阻塞**，但 UI 必须**显著提示**「研究来源 v1 ≠ 执行绑定 v2」，并在 provenance 里记 `sourceDatasetVersionId` 以求可回答「当初是在哪份数据上验证的」。
3. **禁止**：因两者不同就强制一致（会把「研究→执行」的演进路径堵死）；也**禁止**因两者不同就自动改研究来源坐标（那是伪造历史）。
4. **两者都不同时**：仍必须过 `datasetBindingValidation` 的三条判据（存在 ∧ READY ∧ datasetId 一致 ∧ label 一致）。

---

## 10. State Machine

### 10.1 Candidate（**已存在，保持不变**）

```
DRAFT ──► REVIEW ──► ACCEPTED ──► CONVERTED ──► ARCHIVED
  │         │  │          │            │
  │         │  └► REJECTED ┴────────────┴──► ARCHIVED
  │         └► DRAFT（退回）
  └► ARCHIVED
```

机读来源：`researchCore/candidates.ts:113-133`（`CANDIDATE_TRANSITIONS` + `assertCandidateTransition`）+ `assertCandidateConversionCoherence`。

**006.1~006.3 必须补的两条纪律（不新增状态、只加约束）**：

1. 🔴 **`CONVERTED` 只能由 `promote` 到达**。通用 `transition` 端点**必须拒绝** `to = CONVERTED`（否则可绕过定义构建 / 校验 / Registry 校验，直接伪造「已转正」）。
2. 🔴 **不得暴露「直接改 `status`」的通用 update**（现 `ResearchStrategyCandidateUpdatePatch` 已把 `experimentId`/`createdAt`/`updatedAt` 排除，但**含 `status`**）⇒ API 层必须把 `status` 从 `update` 白名单中**摘出**，只走语义化 `transition` / `promote`。

### 10.2 Strategy Version（**复用 C-21.1 八态，禁止新造**）

```
Draft ──► Research ──► Candidate ──► Validated ──► Paper ──► Approved ──► Production ──► Retired（终态）
```

来源：`server/research/lifecycle/types.ts:60-105`（`STRATEGY_LIFECYCLE_STATUSES` / `_ORDER` / `_GENESIS_STATUSES = [Draft, Research]`）。

**转正后的初始状态**：`Draft`（缺省）或 `Research`（调用方显式指定）——**只能取 `STRATEGY_LIFECYCLE_GENESIS_STATUSES` 白名单内的值**，不新造、不跳过。

**⚠️ 明确拒绝指令 §12 建议的 `DRAFT/VALIDATED/PUBLISHED/ARCHIVED` 四态**：它与 C-21.1 八态**重叠且更窄**，采用即产生两套策略状态真相（违反 §25 禁止 7「不为完整而堆状态」，也违反项目「同一口径唯一权威」）。**唯一未决项**（登记，006.1 再定）：`research.lifecycle.transition` 的无状态纯函数与 `setVersionStatus` 的落库迁移是否合并为单一入口（本 STEP 不改行为）。

---

## 11. API Design

### 11.1 端点（按最终模型裁剪，非机械照抄）

| 端点 | 类型 | 权限 | 说明 |
| --- | --- | --- | --- |
| `research.researchEngine.listCandidates` | query | **public** | ✅ **已存在，保留原路径**（不为「好看」而搬路由 —— 前端 `CandidatesPanel.tsx` 已接）。**不新建重复端点** |
| `research.strategyCandidate.get` | query | public | 按 `id` 取候选，**并解析** experiment / conclusion 摘要 + `sourceDatasetVersionId` 的 Registry label |
| `research.strategyCandidate.createFromConclusion` | mutation | **admin** | 登记候选（见 §11.2） |
| `research.strategyCandidate.update` | mutation | **admin** | 白名单 patch：`name` / `description` / `entryRule` / `filterRule` / `exitRule` / `riskRule` / `parameterSpace`。🔴 **不含 `status` / `experimentId` / `conclusionId` / `strategyDefinitionId` / `sourceDatasetVersionId`** |
| `research.strategyCandidate.transition` | mutation | **admin** | `to ∈ {REVIEW, ACCEPTED, REJECTED, ARCHIVED}`；🔴 **`CONVERTED` 一律拒绝**并提示走 `promote` |
| `research.strategyCandidate.promote` | mutation | **admin** | 转正（见 §11.3）。**唯一**能产生 `CONVERTED` 的入口 |
| （Strategy 侧，**已存在**）`research.strategy.save` / `createVersion` / `setVersionStatus` / `validateVersion` | — | admin/public 按 STRATEGY-004 现状 | **不新增**，`promote` 内部复用 `StrategyService` |

**权限原则核对**：与项目真实代码一致 —— 读 `publicProcedure`、写 `adminProcedure`（`researchEngine` 全部写端点、STRATEGY-004 收紧后的 `research.strategy.*` 均如此）。

### 11.2 `createStrategyCandidateFromConclusion`

**输入**

| 参数 | 必须 | 说明 |
| --- | --- | --- |
| `conclusionId` | ✅ | 唯一必需入参 |
| `name` | 可选 | 缺省 = 结论 `title` |
| `description` | 可选 | 缺省 = 结论正文摘要（**引用，不复制改写成新说法**） |
| `overrides.entryRule` / `filterRule` / `exitRule` / `riskRule` / `parameterSpace` | 可选 | 人写的草图；不传即留空（**不自动生成**） |
| `datasetVersionId` | ❌ **不接受** | 来源坐标恒取 `experiment.datasetVersionId`（防止研究来源被改写） |

**输出**：`StrategyCandidate`（含解析后的 experiment / conclusion / dataset label 摘要）

**校验链（顺序固定，逐条响亮失败）**

| # | 校验 | 错误码 |
| --- | --- | --- |
| 1 | Conclusion 存在 | `CONCLUSION_NOT_FOUND` |
| 2 | Conclusion 属于有效 Experiment（`experimentId` 有对应行） | `EXPERIMENT_NOT_FOUND` |
| 3 | Experiment 有有效 Dataset 坐标（`datasetVersionId > 0`） | `DATASET_VERSION_INVALID` |
| 4 | Dataset Version 存在 **∧ `status = READY`** | 复用 `DATASET_VERSION_NOT_FOUND` / `DATASET_VERSION_NOT_READY` |
| 5 | Conclusion 允许生成 Candidate：`status ∈ {DRAFT, FINAL}`（`SUPERSEDED` 拒绝） | `CONCLUSION_NOT_CANDIDATE_ELIGIBLE` |
| 6 | 重复生成：同 `conclusionId` **+ 同 `name`** 已存在 ⇒ 拒绝（提示改用 `update`） | `CANDIDATE_NAME_CONFLICT` |
| — | 一个 Conclusion **可否**产生多个 Candidate？ | ✅ **允许**（1:N）。不同名字即合法多份；**不加 DB 唯一约束** |
| 7 | `assertCandidateInput`（既有）+ `filterRule` 过 `assertConditionSet`（既有） | `ResearchCandidateError` |

第 4 步复用既有 `datasetBindingValidation` 的**只读端口**（`DbDatasetRegistry#getVersionById`），**不写第二套 SQL**。

### 11.3 `promoteCandidate` —— 唯一正式入口

**输入**：`candidateId`（必填） | `targetStrategyId`（可选：缺省由候选 `name` 派生并查重） | `version`（可选，缺省 `1.0.0`） | `status`（可选，∈ `GENESIS_STATUSES`，缺省 `Draft`） | `overrides.datasetBinding`（可选） | `overrides.datasetDivergenceReason`（**给了 divergence 就必须给**）

**输出**：`{ strategyId, version, strategyVersionId, provenanceWritten, candidateStatus }`

**强制流程（顺序不可交换）**

```
① 载入 candidate → 断言 status === "ACCEPTED"（否则 CANDIDATE_NOT_ACCEPTED）
② 幂等闸门：若 candidate.strategyDefinitionId 已非空 **或** provenance 已有该候选行
   ⇒ 直接返回既有 strategyId（不新建第二份、不报错）
③ build StrategyDefinition（definitionBuild.ts 显式转换器，**唯一实现**）
     Candidate.entryRule  ─► definition.entry{event:{type}, observationWindow, conditions[], trigger}
     Candidate.filterRule ─► definition.entry.conditions[]
     Candidate.exitRule   ─► definition.exit.rules[]
     Candidate.riskRule   ─► definition.risk（+ position 约束）
     Candidate.parameterSpace ─► definition.parameters[]（parameterRole=TUNABLE）
     sourceDatasetVersionId   ─► definition.datasets[PRIMARY].datasetVersionId + label
   ⚠️ 转换失败/字段缺失 ⇒ **响亮报错，绝不静默补默认值**
④ validateStrategyDefinition（L1–L8 Look-Ahead 静态校验）⇒ 失败即拒绝
⑤ Dataset Registry 校验（overrides 或继承）⇒ 三条判据，缺一即拒
⑥ StrategyService.create()（strategyId 不存在时）→ createVersion()（**含同事务 5 投影 + fingerprint**）
      └─ 内部：db.ts#saveVersion 事务内再跑一次 assertStrategyDatasetBindings
⑦ 同事务写 strategy_research_provenance（origin='DIRECT'，快照值来自 candidate）
⑧ 回写 candidate：status='CONVERTED' + strategyDefinitionId=<strategyId>
      └─ 经 assertCandidateConversionCoherence（既有）二次把关
```

**🔴 跨存储事务边界（必须登记的真实约束）**：⑥⑦ 在 Strategy 库（`saveVersion` 事务），⑧ 在 Research 库 —— **两次写不在同一事务**（项目无跨模块事务设施，且不加 FK）。失败语义必须显式定义：

| 失败点 | 后果 | 处置（强制） |
| --- | --- | --- |
| ①~⑤ 失败 | 零写入 | 直接抛，无残留 |
| ⑥⑦ 失败 | 回滚（同事务），candidate 保持 `ACCEPTED` | 直接抛 |
| **⑧ 失败** | Strategy 已存在、candidate 仍 `ACCEPTED` | **不静默**：抛出 `PROMOTE_WRITEBACK_FAILED` 并**带上已生成的 `strategyId`**；**② 的幂等闸门**（查 provenance 是否已有该候选行）保证重试**不会产生第二份 Strategy** |

**明确禁止**：`Candidate → bypass validation → Strategy Version`（§11）。`promote` 是**唯一**写 `CONVERTED` 与 provenance 的入口。

---

## 12. Service Boundary

**新增** `server/research/strategyCandidate/`（语义目录名，**不含 STEP 编号**）：

```
server/research/strategyCandidate/
├── types.ts            候选领域类型 + 错误码（复用/扩展 researchCore/candidates.ts 的既有类型）
├── definitionBuild.ts  Candidate 草图 ─► StrategyDefinition 的**唯一**显式转换器（纯函数、确定性）
├── service.ts          StrategyCandidateService：createFromConclusion / load / list / update
│                       / transition / promote
├── provenance.ts       溯源读写（DbStrategyResearchProvenanceRepository）
├── index.ts
└── *.test.ts
```

**依赖方向（单向，铁律）**

```
                  ┌──────────────────────────────┐
                  │ StrategyCandidateService     │  ← 唯一的桥
                  └───┬──────────────────┬───────┘
                      │                  │
        ┌─────────────▼──────┐   ┌───────▼────────────────────┐
        │ server/researchCore│   │ strategySchema             │
        │ （Research 领域+持久化）│   │ strategyPersistence        │
        └────────────────────┘   └────────────────────────────┘
             ▲                              ▲
             └────── 二者**互不 import** ─────┘
```

- **禁止** `researchCore` 出现 `strategySchema` / `strategyPersistence` 的 import。
- **禁止** `strategyPersistence` 出现 `researchCore` 的 import。
- **禁止** `ResearchService` 直接操作 `StrategyRepository`。
- `Research → StrategyCandidateService → StrategyPersistence` ✅ 唯一合法方向。

**唯一例外（本 STEP 显式设计并登记）**：`cloneVersion` 需继承 provenance ⇒ `StrategyService` 接受一个**可选注入端口** `StrategyProvenancePort`（与既有 `constructor(datasetRegistry: DatasetVersionReferencePort = new DbDatasetRegistry())` **同风格**），缺省 no-op ⇒ **不构成反向依赖**（由 `strategyCandidate` 在装配时注入实现）。**006.3 落地**。

**可执行的边界守护（建议 006.1 一并落地）**：新增 `importBoundary.test.ts` —— 读源文件文本，断言 `server/researchCore/**` 不含 `strategyPersistence|strategySchema`、`server/research/strategyPersistence/**` 不含 `researchCore`。把「靠人守」变成「靠测试守」。

---

## 13. Database Logical Design

> **本 STEP 不创建 migration。** 以下仅为逻辑设计；DDL 与幂等 apply 脚本归 006.1（流程遵循项目约定：`drizzle/schema.ts` → 手写 `drizzle/NNNN_<semantic>.sql` → 幂等 `scripts/applyXxx.mjs` + `information_schema` 断言；**禁 `db:push` / `drizzle-kit generate`**；**禁手工补写 `_journal.json`**）。
> **跨模块引用一律不加 FK**（项目既有原则），完整性由应用层 + 事务保证 —— **不改变该原则**。

### 13.1 `research_strategy_candidate`（**最小增列，不新建表**）

| 列 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `sourceDatasetVersionId` | `bigint` | YES | 来源坐标快照 = `dataset_version.id`（写入时复制自 experiment，之后不变） |
| `sourceResearchRunId` | `bigint` | YES | `research_run.id`（提不出即 NULL） |
| `sourceTraceJson` | `longtext` | YES | 细粒度证据快照（analysisId / metricCode / effectLabel / disclaimer） |
| `sourceDatasetDivergenceReason` | `varchar(512)` | YES | 仅当转正绑定与研究来源不同数据集版本时非空 |

- **PK**：`id`（既有）。
- **唯一约束**：**不新增**（1:N 是设计选择，见 §11.2 第 6 条）。同 `conclusionId + name` 的重复由**应用层**软拒绝。
- **索引**：新增 `idx_research_candidate_source_dataset_version (sourceDatasetVersionId)` —— 支持「这个数据集版本产出了哪些候选」。既有 4 个索引保留。
- 既有 5 个 `*Json` 列（entry/filter/exit/risk/parameterSpace）**语义不变**，仍为 Research 侧草图。

### 13.2 `strategy_research_provenance`（**新表，1 张，只增不减**）

```
PK        id                    bigint auto_increment
          strategyVersionId     int            NOT NULL   -- strategy_versions.id（权威行锚）
          strategyId            varchar(64)    NOT NULL   -- 冗余直查
          strategyVersion       varchar(32)    NOT NULL   -- semver
          sourceCandidateId     bigint         NOT NULL   -- 快照值，非 FK
          sourceConclusionId    bigint         NOT NULL   -- 快照值，非 FK
          sourceExperimentId    bigint         NOT NULL   -- 快照值，非 FK
          sourceResearchRunId   bigint         NULL
          sourceDatasetVersionId bigint        NULL       -- 研究来源坐标（快照）
          sourceDatasetLabel    varchar(96)    NULL       -- 显示用 label（v1/v2/rd-…）
          sourceSnapshotJson    longtext       NULL       -- sourceTraceJson 副本
          origin                varchar(16)    NOT NULL DEFAULT 'DIRECT'  -- DIRECT | INHERITED
          createdAt             timestamp      NOT NULL
UNIQUE    uq_strategy_research_provenance_version (strategyVersionId)
INDEX     idx_strategy_research_provenance_strategy (strategyId)
INDEX     idx_strategy_research_provenance_conclusion (sourceConclusionId)   -- 反向查「这个结论产出过哪些策略」
INDEX     idx_strategy_research_provenance_candidate (sourceCandidateId)     -- promote 幂等闸门用
FK        无（**0**）—— 与全库一致
```

- **删除策略**：随 `deleteStrategy` 同事务显式删除（应用层，非级联）；上游 Research 行删除**不触发任何动作**。
- **写入时机**：`promote`（`origin='DIRECT'`，与 strategy 写入同一事务）；`cloneVersion`（`origin='INHERITED'`，006.3）。
- **不写 `SOURCE_DELETED` 状态列**：来源存活与否由**读取时探测**如实标注（§8.3）。

### 13.3 本 STEP 明确**不做**的 DDL 变更

- ✗ 不给 `strategy_versions` / `strategy_version_datasets` 加任何 research 列（切面在 13.2）。
- ✗ 不改 `StrategyDocument` / `StrategyVersionRecord` schema（不递增 `STRATEGY_DOCUMENT_RECORD_VERSION` / `STRATEGY_VERSION_RECORD_VERSION`）⇒ **指纹与既有版本零影响**。
- ✗ 不建 `strategy_drafts`（§5 拒绝方案 A/B）。
- ✗ 不改 Dataset Registry 任何表。
- ✗ 不给任何表加 FK。

---

## 14. 首板回踩示例（纯设计级，不含实施）

**真实坐标（实查）**：Dataset `120001 = first_limit_pullback`；Version `390002 = v2`（`status = READY`）；Experiment `240002`（已 COMPLETED）；Conclusion `330001`（`SUPPORTED` / `DRAFT`）。

```
Research Conclusion（例：由 240002 的 SEGMENT_RELATION / CONDITIONAL 分析产出）

  首板后 1~5 个交易日内，若盘中最低价回踩但不跌破首板日开盘价，
  其未来收益分布与「跌破」组存在方向性差异（引擎按规则给出 SUPPORTED / 主观置信度，
  ⚠️ 不是 p-value；标签必须如实携带）
        │
        │  人的动作 ①：登记候选
        ▼
StrategyCandidate（草稿态，人的意图 —— 允许「不合法于 Strategy 词表」）
  name:            首板回踩不破开盘价
  sourceDatasetVersionId: 390002（v2 快照）
  sourceResearchRunId:     <由 evidence.primaryAnalysis.analysisId 反查；提不出即 NULL>
  entryRuleJson:    { event: "FIRST_LIMIT_UP", timing: "NEXT_OPEN" }
  filterRuleJson:   条件组：bar.low >= prefix.rd0.open
  exitRuleJson:     {}                       ← 刻意留空：出场「待研究」
  riskRuleJson:     {}
  parameterSpaceJson: { holdGuardDays: { type:"number", min:1, max:5, step:1 } }
  status:           DRAFT
        │
        │  人的动作 ②：REVIEW → ACCEPTED → promote
        ▼
StrategyDefinition（显式转换 + 强制校验后的产物）
  entry.event.type            : FIRST_LIMIT_UP
  entry.observationWindow     : { start: 1, end: 5, unit: TRADING_DAY }
  entry.conditions[0]         : { field: "bar.low", operator: GREATER_THAN_OR_EQUAL,
                                  valueType: FIELD_REFERENCE, value: "prefix.rd0.open" }
  entry.trigger.type          : FIRST_VALID_DAY
  exit.rules                  : []   ← 空数组合法（= 持有至期末退出）；**不自动补 5 日退出**
  parameters[0]               : { code: "holdGuardDays", parameterRole: "TUNABLE", min:1, max:5, step:1 }
  datasets[PRIMARY]           : { datasetId: "first_limit_pullback", datasetVersionId: 390002,
                                  datasetVersion: "v2", role: "PRIMARY" }
        │
        ▼
strategies(首板回踩不破开盘价) + strategy_versions(1.0.0, status=Draft) + 5 投影
  + strategy_research_provenance(sourceConclusionId=330001, sourceDatasetVersionId=390002, origin=DIRECT)
```

**两个必须点明的技术要点**：

1. 🔴 **「首板日开盘价」写 `prefix.rd0.open`，不能写 `event.open`**。T 日 OHLCV 在 `prefix.relativeDay = 0`，`event` 表**没有 OHLCV 列**（`STRATEGY_EVENT_FIELDS` 白名单实查无 `open`）。写错会被 Look-Ahead 校验拦下（`UNKNOWN_FIELD_REFERENCE`）——这是 `definition.ts` 头部明确记录的真实陷阱。
2. 🔴 **Research 只能给「候选规则」，不得擅自把「最佳参数 / 最佳收益」固化成正式规则**。本示例刻意把 `exit.rules` 留空、把持有天数放进 `parameterSpace`（`parameterRole=TUNABLE`）⇒ 参数化归 **Parameter Search**，不归 Research。若把「回测最优的第 3 天」直接写死进 `exit.rules`，那就是**把研究层的观测当成策略层的决策**，且会让 `TUNABLE` 空间提前坍缩（本项目 Parameter Search 已按 `parameterRole` 消费，写死即不可搜）。

---

## 15. RESEARCH-006.1 实施范围

**原则：一次只实施一个 STEP。006.0 到此为止，不提前开发 006.1~006.5。**

| STEP | 范围 | 关键交付 | 明确不做 |
| --- | --- | --- | --- |
| **006.1**<br>数据库 + Domain Model | ① `drizzle/schema.ts` 增 4 列 + 1 新表<br>② 手写 `drizzle/0036_*.sql` + 幂等 `scripts/apply*.mjs`（`information_schema` 断言：列类型/可空/索引/唯一/零 FK + 既有 12 表行数与逐行内容不变）<br>③ `researchCore/repository` 扩展 candidate 的 4 个新列读写（`db.ts` + `inMemory.ts` **同语义**）<br>④ `provenance.ts` 仓储 + `types.ts` 错误码<br>⑤ `importBoundary.test.ts` 边界守护<br>⑥ 真实 TiDB apply + `--check` 幂等重放 | migration 幂等 PASS 断言输出；既有 research 表零变化证据 | ✗ 不改 `researchCore/candidates.ts` 状态机<br>✗ 不给 candidate 加写 API<br>✗ 不建 `strategy_drafts` |
| **006.2**<br>Conclusion → Candidate Service | ① `createStrategyCandidateFromConclusion`（§11.2 七步校验链）<br>② 读端点：`get`（含 experiment/conclusion/dataset label 解析）<br>③ `update`（白名单**摘除 `status`**）+ `transition`（**拒绝 `CONVERTED`**）<br>④ 注册新 router（**保留**既有 `researchEngine.listCandidates` 不动） | 纯函数化校验链 + 单测（每条错误码一例）；真实 tRPC `createCaller` 全链 | ✗ 不做 promote<br>✗ 不写任何 `strategy_*` 表<br>✗ 不做前端 |
| **006.3**<br>Candidate → Strategy（promote） | ① `definitionBuild.ts` 显式转换器（**唯一实现**）<br>② `promote`（§11.3 八步 + 幂等闸门 + 失败语义）<br>③ provenance 同事务写入 + `origin=DIRECT`<br>④ `cloneVersion` 继承 provenance（`origin=INHERITED`，经注入端口）<br>⑤ 回写 candidate（`CONVERTED` + `strategyDefinitionId`） | 「草图→Definition」转换的单测（合法/非法各若干）+ promote 幂等 + ⑧ 失败可重试不留第二份 Strategy | ✗ 不做 Dataset Registry 修改<br>✗ 不做 Backtest |
| **006.4**<br>API + Frontend | ① 端点收口（错误码 → tRPC code 映射，**必须走 `toTrpcError`**）<br>② `CandidatesPanel` 升级（登记 / 编辑 / 迁移 / 转正 + 空态重写）<br>③ Strategy 侧 provenance 展示（含「研究来源 ≠ 执行绑定」显著提示 + 来源已删除的如实标注）<br>④ adapter 层（`API → Adapter → ViewModel → UI`，不把裸 JSON 漏给视图层） | 纯函数层测试 + `vite build` RC=0；**不把浏览器截图写进验收路径** | ✗ 不新增依赖<br>✗ 不做实体机截图验收 |
| **006.5**<br>真实 TiDB + tRPC + Regression | ① `scripts/verifyResearchStrategyBridge.mts`（真实 TiDB + `appRouter.createCaller`，覆盖六端点 + 三类负例零写入 + 幂等 + provenance 裸 SQL 复核）<br>② `tsc --noEmit` / 聚焦套件 / 全量 vitest（**失败集合与基线逐项一致**）<br>③ 自建自清（不污染用户既有 `240002 / 450001` 数据） | 可复现验收脚本 + 证据文件 | ✗ 不改任何生产数据 |

---

## 16. 明确不做的事情

**本 STEP（006.0）**：

- ✗ 未改任何 schema / 未写 migration / 未建表
- ✗ 未改任何生产业务代码 / 未改 Dataset Registry / Research Engine / Strategy 持久化 / UI / Backtest / Parameter Search / OOS / Simulation / Production
- ✗ 未删任何 legacy Strategy 或 legacy Research Dataset / 未做任何数据迁移
- ✗ 未修复审计中发现的任何缺陷（B1~B6 / §4.2 A~F 全部**只登记不处理**）

**006.1~006.5 也明确不做**：

1. ✗ `research_result.strategyVersionId`（§25 禁止 1：Result 可变，不做锚点）
2. ✗ Research → 自动创建正式 Strategy Version（§25 禁止 2）
3. ✗ 第二套 `researchDatasetVersionId` / `strategyDatasetVersionId`（§25 禁止 3）
4. ✗ 让 Candidate 成为新的 Canonical（§25 禁止 4）
5. ✗ 为 Research→Strategy 而修改 Dataset Registry（§25 禁止 5）
6. ✗ 为 Candidate 而提前开发 Backtest（§25 禁止 6）
7. ✗ 为「完整」一次新增大量状态 / 表 / API（§25 禁止 7）——本设计**只新增 1 张表 + 4 列 + 2 个迁移端点**，且**不新增任何状态集合**（复用既有 Candidate 六态与 C-21.1 八态）
8. ✗ 新建 `strategy_drafts`；✗ 改 `StrategyDocument` / `StrategyVersionRecord` schema
9. ✗ 修 `research.lifecycle.transition` 无状态问题（**登记**，另行裁定）
10. ✗ 让 Strategy 依赖 Research 才能运行（**`strategy_research_provenance` 为 display-only**）

---

## 附录 · 设计结论（Q1–Q10）

| # | 问题 | 结论 |
| --- | --- | --- |
| **Q1** | Research → Strategy 中间是否需要 Candidate？ | **YES** —— 且**已存在**（`research_strategy_candidate`，状态机与 Repository 齐备，仅缺写入调用点） |
| **Q2** | Candidate 与 Draft 是否分离？ | **NO**（方案 C）。C-21.1 八态的 `status` 已承担 Draft 职责；另建 `strategy_drafts` 会制造第二 Canonical 与状态撞名 |
| **Q3** | 谁是 Canonical SoT？ | **`strategy_versions.strategyDocumentJson`（内含 `definition`）** —— 保持不变 |
| **Q4** | Research 是否可以直接修改 Strategy？ | **NO**。必须经 Candidate + 人的「登记 / 转正」两个显式动作 |
| **Q5** | Dataset 跨模块坐标是什么？ | **`datasetVersionId = dataset_version.id`** —— 唯一，禁第二套 |
| **Q6** | Research 与 Strategy Dataset 是否必须一致？ | **条件允许不同**。缺省继承；不同须显式 `overrides.datasetBinding` + `datasetDivergenceReason` 并显著提示；研究**来源**坐标恒以 `sourceDatasetVersionId` 快照留痕 |
| **Q7** | Research provenance 最少保存什么？ | `sourceConclusionId`（必）+ `sourceResearchRunId`（必、可空）+ `sourceExperimentId`（必）+ `sourceDatasetVersionId`（必，快照）+ `sourceTraceJson`（可空）。**不存** `resultId`（Result 可变）；**不列化** `analysisId`（可多、可现取） |
| **Q8** | Candidate 是否存完整 Definition？ | **NO**。存「研究意图草图」（既有 5 个 `*Json` 列，Research 词表）；转正时经**唯一显式转换器**产出 `StrategyDefinition` 并强制 `validate` |
| **Q9** | Candidate → Strategy 的正式入口是什么？ | **`StrategyCandidateService.promote()`**（`server/research/strategyCandidate/service.ts`），tRPC `research.strategyCandidate.promote`（admin）。它是**唯一**能写 `CONVERTED` 与 provenance 的入口 |
| **Q10** | Strategy 是否能够脱离 Research 独立执行？ | **YES**。provenance 为 display-only、快照值、零 FK；Research 删除后 Strategy Version 仍可 `validate` / `backtest` / `simulate` / `execute` |

---

## 附录 · 审计证据清单

| 证据 | 来源 |
| --- | --- |
| 12 张 `research_*` / 6 张 `strategy_*` / 3 张 `dataset_*` 表存在性与行数 | `docs/evidence/_r006_probe.mjs` → `docs/evidence/_r006_probe_result.md`（真实 TiDB 只读） |
| `research_conclusion` / `research_strategy_candidate` 真实列 / 索引 / **零外键** | 同上（`information_schema`） |
| `research_result` / `research_analysis` / `research_run` **零 dataset 列** | 同上 |
| `strategy_versions` 真实列中**无 research 溯源列** | 同上 |
| `research_conclusion` 7 行全 `DRAFT`、`research_strategy_candidate` **0 行**、`strategy_versions` **0 行** | 同上 |
| `dataset_version` 2 行（390001=v1 / 390002=v2）均 `READY`；`dataset_definition` 120001 = `first_limit_pullback` | 同上 |
| 结论由引擎规则式生成 | `server/researchEngine/engine.ts:311` + `conclusion.ts#buildConclusion` |
| 结论归属靠 `evidence` 反推、**无 `runId`** | `server/researchEngine/maintenance.ts:138-151` |
| Result 重算即覆盖（非 immutable） | `server/researchEngine/engine.ts:712-714` |
| Candidate 无写入路径（`create`/`update` 零调用） | `server/researchCore/repository/contract.ts:219-225` + 全库 grep |
| Candidate 状态机与转正一致性校验已实现 | `server/researchCore/candidates.ts:113-152` |
| 级联删除会连 candidate 一起删 | `server/researchEngine/maintenance.ts`（`deleteExperimentCascade`） |
| Strategy Canonical SoT + 5 投影单向派生铁律 | `drizzle/schema.ts:584-591` |
| `datasetVersionId` 唯一坐标 + 校验三错误码 | `drizzle/schema.ts:543-549, 735-743` + `strategyPersistence/datasetBindingValidation.ts` |
| C-21.1 八态 + genesis 白名单 `[Draft, Research]` | `server/research/lifecycle/types.ts:60-105` |
| `definition` 字段时间域目录 / `prefix.rd0.open` 陷阱 | `server/research/strategySchema/definition.ts:23-42, 211-239` |
| 生命周期迁移当前为**无状态纯函数** | `server/researchRouter.ts:233-248` |
