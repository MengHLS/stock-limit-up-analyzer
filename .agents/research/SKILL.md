---
name: research-agent
description: 研究链路（Dataset → Experiment → Run → 实验结论(自定义 payload) → Candidate → Strategy）的统一理解与执行规范，强调 Dataset Version、实验口径、provenance 与可追溯性。Finding / Conclusion 不属于本平台概念。
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
实验结论（自定义 payload）
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

## 3.5 🔴 科学有效性必答清单（P1–P6 · `PLAN-RESEARCH-DESIGN-001`）

> §3 保证「可复现、可追溯、不伪造」。本节保证「**可判定**」——两者都必须满足。
> **每一条都由一次真实事故暴露**（见 `docs/research/PLAN-RESEARCH-DESIGN-001.md` §1）。

**任何实验，无论大小，结论区必须回答：**

| # | 必答 | 为什么（事故） |
|---|---|---|
| **P2** | **靶指标是什么？为什么它对应研究目标？** 尾部目标必须把**尾部计数/概率列为主判据**，并**同时**报均值 | t74 全程用组合总收益，而 **151.0958% = 9 笔**、top10% 占比 438.7% ⇒ 那个「主指标」是约 5 笔的统计量；`bigWin50/100Count` 早在 schema 却从未作主判据 |
| **P1** | **每个 `excludedByReason` 桶在靶上的画像**（占比/均值/尾率/分位）。若与保留群显著不同，**必须在结论区显式讨论**，不得只当一行计数 | 回踩门剔掉的 **21,667 事件（29.8%）** 右尾**系统性更厚**（rd20 `≥+100%` **0.26% vs 0.12%，+117%**），而样本账一直是**平的** ⇒ 记账正确，却无人问「剔掉的那群在靶上什么样」 |
| **P3** | **排序/评分在【入选边界】的分辨力四件套**：① 不同取值数；② 最大取值占比；③ **边界并列规模**；④ 破平键及其经济含义 | 3F 仅 **≤18 档**、**3 档覆盖 86.9%**、最高分**并列 262 笔**、破平键 = `securityId.localeCompare`（**不透明 UUID**）⇒ 三个不同扰动摆动几十~几百 pp（加宽槽位 **−1.5%**、剔次新 **65.39%**、trend 融合 **−166~−228pp**）。**不是因子弱，是仪器坏。** 边界并列 ≥ 入选名额 ⇒ 该实验**实质在测破平键**，必须如此标注 |
| **P4** | **变动项的效应量 / 主导固定项的量级**，比值多少 | P0–P10 多在 Runner（占 **89.5%**）固定时测选股小项；而**单参数** 6%→8% 即摆动 **86.5pp**。比值过低（如 < 10%）⇒ 结论必须标注**「该 Δ 落在主项噪声内，不足以支撑取舍」** |
| **P5** | **事前判据 / ABORT 条件 / 停止规则**（`preRegisteredCriteria`），**事后不得修改**；一族实验须声明停止规则 | 47 实验 / 162 Run 呈**广度堆叠**，下一步由上一轮结果决定。既有合并结论「**这条链上没有免费降回撤的旋钮**」正是**矿脉挖尽**的签名 |
| **P6** | **靶指标按时间分层**（至少逐年；与大盘状态交叉更好）。效应集中在少数年份 ⇒ 必须标注**「regime 观察，非因子效应」**，并**禁止作为转正依据** | **6/9 赢家在 2025–2026**、2025 单年 = 净利 **61%**、权益峰 **2022-03 → 2025-05-12（3.2 年空转，`maxDrawdownDurationDays=907`）** ⇒ regime 签名 |
| — | **样本账**（`eligible + excluded === candidate`）+ `unscannedEventCount` | 既有 §3-3 / §3-4 |

**P1–P6 均为「报告要求」**，多数可由既有 `customPayload` / `tables` / `statistics` 承载；
其中 **P2（靶指标）与 P5（预注册判据）建议进 `ExperimentDefinition` 契约的可选字段**
（`targetMetric` / `preRegisteredCriteria`，缺省 = 既有实验不受影响）。

🔴 **前置闸门**：**P3 未达标时，不得开展任何排序/因子类实验** —— 否则测到的是破平键噪声，不是因子效应。

## 4. Candidate → Strategy 的 provenance

- 唯一写入口：`research.strategyCandidate.promote` / `experimentStrategy.createFromExperiment` / `experimentStrategy.createFromEvidenceRuns`。
- 唯一来源表：`strategy_research_provenance`（`UNIQUE(strategyVersionId)`）。
- **证据指纹独立**：`strategy_versions.fingerprint` 只表示**策略文档**指纹；证据指纹形如 `evi-sha256:…`。两者**不得混用**。
  - 换可解析但不同的 `reference` ⇒ `…_PROVENANCE_CONFLICT`；指向不存在字段 ⇒ `…_REFERENCE_UNRESOLVED` —— **两者都不落行**。
- `sourceCandidateId` / `sourceConclusionId` 是旧链遗留列 ⇒ 新链**一律 NULL**。
- **Candidate 必须能够追溯到「证据来源」**：独立实验证据 Run，或**历史 Finding · Conclusion 遗留链**（该链已退役，见 §2 —— 🔴 Finding / Conclusion **不属于本平台概念**，见 `docs/product/PRODUCT-DECISIONS-001.md` PD-02）；`sourceFindingIdsJson` 为空属**证据链断裂**（历史遗留），新写入不得复现。

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
实验结论(自定义 payload)   结论与证据链（Finding/Conclusion 已退役）
Candidate → Strategy       转正路径 + 溯源行
Tests
Remaining Risks
Next Step
```