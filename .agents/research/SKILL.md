---
name: research-agent
description: 研究链路（Dataset → Experiment → Run → Finding → Conclusion → Candidate → Strategy）的统一理解与执行规范，强调 Dataset Version、实验口径、provenance 与可追溯性。
---

# Research Agent Skill

> 先读仓库根 `AGENTS.md` §2（不变量）。
> 🔴 研究的**唯一运行时坐标**是 `datasetVersionId`；`decisionOffsetDays` 是判定日坐标。

## 1. 统一链路

```text
Dataset
 ↓
Experiment
 ↓
Run
 ↓
Finding
 ↓
Conclusion
 ↓
Candidate
 ↓
Strategy
```

## 2. 本仓库当前的两种「研究」（务必分清）

| 体系 | 代码 | 数据 | 状态 |
|---|---|---|---|
| **独立研究实验体系**（当前权威） | `research-experiments/**`（作者面） + `server/researchExperiments/**`（运行/持久化） + `shared/researchExperimentsContracts.ts` + `client/src/{pages,}/researchExperiments/**` | Run 元数据进 `research_experiment_run`；结果与产物进**对象存储**（经 `server/artifactStorage/**`） | **ACTIVE** |
| **闭环研究运行**（策略运行工作台） | `server/researchRunRouter.ts` + `server/research/closedLoop/**` + `server/research/closedLoopWiring/**` | `closed_loop_backtest_run` | **ACTIVE** |

⚠️ **旧 Research 链路已退役**（`RESEARCH-EXPERIMENT-003`）：旧的 `researchCore` / `researchEngine` / `researchPlanner` 代码已整体删除，旧单数 10 表已 DROP 或 RENAME 为 `archive_research_*`（migration `0046_legacy_research_retire.sql`），**代码侧零引用**。
⇒ 见到 `archive_research_*` 表**不得**重新接回读路径；见到 `analysisId` / `findingIds` / `conclusion` / `candidateId` 出现在独立实验体系里 ⇒ **违反契约**（见 §4）。

## 3. 独立实验体系硬约束（违反会被响亮拒绝）

1. **不能绕过 Dataset 契约**：实验拿不到 DB，只能经 `context.dataset` 按 `datasetRequirements` 声明的列与相对日取数。
2. **PIT 是结构级闸门**：未声明 `usesForwardData: true` 时读 `rd ≥ 1` 直接抛错。
3. **样本账必须平**：`eligible + excluded === candidate` 且 `Σ excludedByReason === excluded`，账不平即 `EXPERIMENT_RESULT_INVALID`。
4. 🔴 **「账平」≠「全量」**：需要全量时**唯一合法做法**是声明 `datasetRequirement.eventScanPolicy: "FULL_DATASET"` + 流式分页，并让结果出 `unscannedEventCount`（`0` = 全量成立，`null` = 未知）。**不得**删阀、不得只调大 `maxEvents`。
5. **新增实验 = 复制 `template/` + 两个注册点各 +1 行**（`research-experiments/manifest.ts` / `client/src/researchExperiments/pages.ts`）；**不改** Research Core / Strategy Core / tRPC / DB。
6. **ArtifactStorage 端口是唯一出口**：禁直连 MinIO SDK；前端只经 `GET /api/experiments/artifact`。
7. **Robustness 唯一入口** = `research-experiments/robustnessBridge.ts`（零实现 / 零状态 / 零 IO，只许引类型，有 AST 闸门）⇒ **禁**复制 `ResearchRobustnessEngine` / `…Evaluator` / `…Drift`。
8. 多维矩阵 = **一个 Run 一个基准**（禁一维度一 Run 再拼 ⇒ 互不可比）；自检行 delta **恰为 0**；信封 `eligible` ≠ 核心 `eligible`。
9. 行身份字段（`tradeDate` / `relativeDay` / `eventId` / `symbol`）在 `ExperimentBarRow` 上，**不在** `values` 里 ⇒ 读 `values.tradeDate` 恒 `undefined`（常见事故）。
10. 产物 `name` **不含角色段**（`tables/` / `charts/` 由 `role` 拼）。

## 4. Candidate → Strategy 的 provenance

- 唯一写入口：`research.strategyCandidate.promote` / `experimentStrategy.createFromExperiment` / `experimentStrategy.createFromEvidenceRuns`。
- 唯一来源表：`strategy_research_provenance`（`UNIQUE(strategyVersionId)`）。
- **证据指纹独立**：`strategy_versions.fingerprint` 只表示**策略文档**指纹；证据指纹形如 `evi-sha256:…`。两者**不得混用**。
  - 换可解析但不同的 `reference` ⇒ `…_PROVENANCE_CONFLICT`；指向不存在字段 ⇒ `…_REFERENCE_UNRESOLVED` —— **两者都不落行**。
- `sourceCandidateId` / `sourceConclusionId` 是旧链遗留列 ⇒ 新链**一律 NULL**。
- **Candidate 必须能够追溯到 Research Finding / Conclusion（或独立实验证据 Run）**；`sourceFindingIdsJson` 为空属**证据链断裂**（历史遗留），新写入不得复现。

## 5. 数据口径要求

1. **明确 Dataset Version**：记录真实 `datasetVersionId`。
2. **明确实验口径**：指标定义、窗口、成本模型、样本筛选。
3. **明确输入**：参数、seed、universe、codeVersion。
4. **明确输出**：结果结构 + 样本账。
5. **保留 provenance**：可复现链路完整（输入 → 版本 → 产物）。
6. 🔴 **不允许用展示名称代替真实 `datasetVersionId`**（label 会指向不同口径）。

## 6. 禁止

- ❌ 修改研究结果 / 回填历史 Run
- ❌ 用展示名 / 内容寻址串代替 `datasetVersionId`
- ❌ 在独立实验体系里引入 `analysisId` / `findingIds` / `conclusionId` / `candidateId`
- ❌ 绕过 `robustnessBridge` 复制 Robustness 核心
- ❌ 绕过 `artifactStorage` 直连对象存储
- ❌ 未经授权修改 Dataset 语义 / 构建口径

## 7. 输出模板

```text
Research Question
Dataset Version            datasetVersionId（真实坐标）+ decisionOffsetDays
Experiment Definition      口径 / 参数 / 窗口 / 信息边界（usesForwardData?）
Inputs                     参数 / seed / universe / codeVersion
Outputs                    结果结构 + 样本账（eligible / excluded / unscannedEventCount）
Provenance                 Run ID / 产物路径 / 证据指纹
Finding → Conclusion       结论与证据链
Candidate → Strategy       转正路径 + 溯源行
Tests
Remaining Risks
Next Step
```