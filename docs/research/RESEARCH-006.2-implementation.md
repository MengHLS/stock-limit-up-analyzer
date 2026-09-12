# RESEARCH-006.2 — Conclusion → Strategy Candidate Service（实施报告）

> **状态**：`RESEARCH-006.2 = COMPLETE`
> **唯一架构基准**：`docs/research/RESEARCH-006.0-architecture.md`
> **前序实施**：`docs/research/RESEARCH-006.1-implementation.md`（DB + Domain Model，已落真实 TiDB）
> **完成时间**：2026-09-12 19:45 GMT+8
> **本 STEP 一句话**：把 006.1 建好的「候选桥」接上**业务线路** —— 只做 `createFromConclusion` / `get` / `update` / `transition` 四个 Candidate 能力，**不转正、不写任何 Strategy 表**。

---

## 1. Objective / 交付范围

006.0 审计已确定：`research_conclusion` 与 `research_strategy_candidate` 都已存在、状态机与 Repository 契约都已实现，**缺的只是写入调用点**（`candidates.create` 全库零调用）。006.1 补齐了数据的「形状」（4 个来源快照列 + provenance 表）。**006.2 补齐数据的「入口」**。

| 交付 | 说明 |
| --- | --- |
| ✅ `createFromConclusion(conclusionId, …)` | 人的动作 ①：把一条 Research Conclusion 登记为 Strategy Candidate |
| ✅ `get(candidateId)` | 读取候选 + 上游摘要 + 来源 Dataset label（来源缺失如实标注） |
| ✅ `update(candidateId, patch)` | **闭集白名单**的普通编辑：只改研究草图字段 |
| ✅ `transition({candidateId, to})` | 生命周期迁移；🔴 **明确拒绝 `CONVERTED`** |
| ✅ `research.strategyCandidate.*` router | 4 个端点；读 `publicProcedure`、写 `adminProcedure` |
| ❌ `promote` / `cloneVersion` / `buildStrategyDefinition` | 属 006.3 |
| ❌ 写 `strategies` / `strategy_versions` / `strategy_version_datasets` / `strategy_research_provenance` | 属 006.3 |
| ❌ Provenance UI / Candidate 前端 / Backtest / Parameter Search / OOS | 属 006.4 / 006.5 |

**§21 硬约束已遵守**：桥在 006.2 阶段**不 import** `strategyPersistence` / `strategySchema`（由 `importBoundary.test.ts` 新增断言守护，见 §12）。

---

## 2. Service API（`StrategyCandidateService`）

位置：`server/research/strategyCandidate/service.ts`（450 行）

```ts
export interface StrategyCandidateService {
  createFromConclusion(input: CreateCandidateFromConclusionInput): Promise<StrategyCandidateView>;
  get(candidateId: number): Promise<StrategyCandidateView>;
  update(candidateId: number, input: StrategyCandidateUpdateInput): Promise<ResearchStrategyCandidate>;
  transition(input: TransitionCandidateInput): Promise<ResearchStrategyCandidate>;
}

export function createStrategyCandidateService(deps: {
  repos: ResearchRepositories;              // 复用既有 Research 仓储（不新造）
  datasetVersions: DatasetVersionReadPort;  // Registry 只读端口（注入式）
}): StrategyCandidateService;
```

- **注入式依赖**：Service 不直接 `new Db…`，因此**可被单测用内存仓储跑**（`service.test.ts` 49 例全部跑在 InMemory 上，零 DB）。
- **`DatasetVersionReadPort`** 只暴露登记所需的三件事：`{ datasetVersionId, label, status, datasetId }` —— **不复制 Registry 版本表、不新增第二套 Dataset 坐标**（006.0 §9）。
- 真实实现 `RegistryDatasetVersionReadPort` 在 `datasetVersionPort.ts`，走 `DbDatasetRegistry`，**只依赖 Registry、不被 Registry 依赖**（反向依赖由 boundary test 守护）。

### 读取视图 `StrategyCandidateView`

```ts
{
  candidate: ResearchStrategyCandidate;   // 候选本体（含 4 个 source* 快照）
  experiment: { id, name, status, datasetVersionId } | null;
  conclusion: { id, title, conclusionType, status, confidence } | null;
  dataset: { datasetVersionId, label, status, datasetId } | null;  // 现查 Registry，不落列
  sourceMissing: ("EXPERIMENT" | "CONCLUSION" | "DATASET_VERSION")[];
}
```

`get()` **只返回 Candidate 域与本步上游摘要**，**不偷偷返回 Strategy Persistence 数据**（006.2 §14）。`sourceMissing` 是「快照而非 FK」的必然产物 —— 上游行可能已被删除，读取时**如实标注**，不报错、不伪造、不自动清理。

---

## 3. `createFromConclusion()` 校验链

唯一必需入参 = `conclusionId`（006.2 §4）。**校验顺序固定，逐条响亮失败**：

| # | 步骤 | 失败错误码 |
| --- | --- | --- |
| 0 | 入参：`conclusionId` 为正整数；`overrides` 键合法 | `INVALID_INPUT` |
| 1 | Conclusion 存在 | `CONCLUSION_NOT_FOUND` |
| 2 | 归属 Experiment 存在 | `EXPERIMENT_NOT_FOUND` |
| 3 | 研究来源 Dataset 坐标合法（正整数字面量） | `DATASET_VERSION_INVALID` |
| 4a | Dataset Version 在 Registry 中存在 | `DATASET_VERSION_NOT_FOUND` |
| 4b | Dataset Version `status === "READY"` | `DATASET_VERSION_NOT_READY` |
| 5 | Conclusion 状态 ∈ `{DRAFT, FINAL}` | `CONCLUSION_NOT_CANDIDATE_ELIGIBLE` |
| 6 | 同 Conclusion + 同名未重复 | `CANDIDATE_ALREADY_EXISTS` |
| 7 | 证据快照 + Run 两跳解析（**不失败，解析不出即 NULL**） | — |
| 8 | 落库（**从不传 `status`**）；落库后复核 `status === "DRAFT"` | `INVALID_INPUT`（不可达防御） |

**第 6 步的重复判据**：`repos.candidates.list({ conclusionId })` 后按 `name.trim()` 精确比对。**不加 DB UNIQUE 约束**（006.0 §13.1）：同一 Conclusion **允许**产多份**不同名**候选（1:N），只拒绝同名。

> ⚠️ **诚实登记**：真实库当前**无 `SUPERSEDED` 结论**（8 行全 `DRAFT`），因此「被取代结论被拒」这一负例分支**仅由单测覆盖**，不假装它已在真实数据上验证过。

---

## 4. Candidate 字段映射（Conclusion → Candidate）

| Candidate 字段 | 来源 | 是否允许调用方覆盖 |
| --- | --- | --- |
| `experimentId` | `conclusion.experimentId` | ❌ |
| `conclusionId` | 入参 `conclusionId` | ❌ |
| `name` | 入参 `name`，缺省 = `conclusion.title` | ✅ |
| `description` | 入参 `description`，缺省 = `conclusion.conclusion`（**原样引用，不改写**） | ✅ |
| `entryRule` | **仅** `overrides.entryRule`，不传即留空 | ✅ |
| `filterRule` | **仅** `overrides.filterRule`，不传即留空 | ✅ |
| `exitRule` | **仅** `overrides.exitRule`，不传即留空 | ✅ |
| `riskRule` | **仅** `overrides.riskRule`，不传即留空 | ✅ |
| `parameterSpace` | **仅** `overrides.parameterSpace`，不传即留空 | ✅ |
| `sourceDatasetVersionId` | `experiment.datasetVersionId`（复制） | ❌ |
| `sourceResearchRunId` | 两跳解析（见 §6） | ❌ |
| `sourceTraceJson` | 证据快照（见 §7） | ❌ |
| `sourceDatasetDivergenceReason` | **恒 NULL**（本 STEP 不转正 ⇒ 不存在「研究来源 ≠ 执行绑定」） | ❌ |
| `status` | **恒 `DRAFT`** —— 代码从不传 `status`，仓储缺省即 DRAFT | ❌ |
| `strategyDefinitionId` | **恒 NULL** | ❌ |

**§10 / §11 红线已遵守**：Research 没研究出来的内容（`entryRule` / `exitRule` / `riskRule` / `parameterSpace`），**Service 不猜**。真实 Conclusion 的结构（`evidenceJson`：`disclaimer` / `policy` / `hypothesisStatement` / `primaryAnalysis` / `contributingAnalyses` / `ruleTrace` / `confidenceBasis`）**不含任何策略规则信息**，因此这 5 个规则列在缺省路径下**全部保持为空**（有单测 `11a` 锁定）。只有**人**通过 `overrides` 显式传入的内容才会落库。

---

## 5. `sourceDatasetVersionId` 来源（唯一 Dataset 坐标）

```
research_experiment.datasetVersionId  ──复制──▶  candidate.sourceDatasetVersionId
```

- **唯一坐标口径不变**：`datasetVersionId = dataset_version.id`（数值）。
- **不接受调用方覆盖**：`assertCandidateOverridesKeys` 明确拒绝 `overrides.datasetVersionId`（006.0 §11.2）；`overrides` 只接受 5 个草图字段。
- **不引入第二套 ID**：不使用 `datasetId + version`、不使用 `version` label（`v1` / `v2`）、不使用旧 `rd-*` 字符串。`label` 仅作为展示字段出现在读取视图里。
- **写后不可变**：普通 `update` 硬拒 `sourceDatasetVersionId`（见 §8）。
- **明确区分「研究来源」与「执行绑定」**：「基于哪份数据研究出来」写在这里；「未来转正后用什么数据执行」属 006.3 的 promote/Strategy 侧。本 STEP 两者必然相同，因此 `sourceDatasetDivergenceReason` **恒 NULL**（一致时填空话 = 造假）。

---

## 6. `sourceResearchRunId` 解析规则

**真实两跳查询**（006.2 §8）：`evidence.primaryAnalysis.analysisId → research_analysis.runId`。

`research_conclusion` **没有 `runId` 列**（006.0 §4.2 B5/E 已实查确认），因此 Run 只能经 evidence 里的 analysisId 反查。

**解析实现**（`resolveSourceRun`）：

1. 取出待反查的 analysisId 序列（**主分析优先、去重、保序**）：
   `primaryAnalysis.analysisId` → `contributingAnalyses[].analysisId` → legacy `analyses[].analysisId`
2. 逐个 `repos.analyses.getById(analysisId)`，收集 `runId`（去重）与查不到的 id
3. **唯一性判据**：去重后的 `distinctRunIds.length === 1` ⇒ 写该值；否则 ⇒ `null`

| 情形 | 结果 |
| --- | --- |
| 恰好一个 runId | 写该 runId |
| 0 个（查不到 / evidence 无 id） | **NULL** |
| 多个（结论跨 Run） | **NULL** |
| analysisId 在库中缺失 | 记入 `missingAnalysisIds`，**不猜** |

🔴 **提不出即 NULL，严禁猜测 / 伪造**。快照里同时记下解析路径（`PRIMARY_ANALYSIS` / `CONTRIBUTING_ANALYSES` / `NONE`）、参与解析的 analysisIds、去重 runIds、缺失 analysisIds —— 让「为什么是 NULL」可回溯。

> 真实库实证：结论 `360001` 的 evidence 含 7 个 analysisId（`420001`~`420007`），全部反查到同一 Run `480001` ⇒ 服务写入 `480001`，与**裸 SQL 独立算出的期望值**一致。

---

## 7. `sourceTraceJson` 结构（最小充分 provenance snapshot）

位置：`server/research/strategyCandidate/evidenceTrace.ts`（267 行，**纯函数、确定性、不写时间戳**）。

**它不是 `research_result` 的第二份存储**（006.2 §9）：`research_result` **会被重算覆盖**（`engine.ts` 的 `deleteByAnalysis` + `createMany`），所以快照是唯一能长期回答「这条候选当初凭什么」的手段。因此：

- **只读结论自身的 `evidenceJson`**，**不**额外拉取 `result` / `analysis` / `run` 的内容整体序列化；
- 对未知 / 缺失结构**保持沉默**（返回 `null` / 空数组），**绝不猜测、绝不补默认值**；
- **不写入任何时间戳**（确定性；行级 `createdAt` 已承担时间语义）。

快照形状（`snapshotFormatVersion: 1`）：

```
{
  snapshotKind: "research_conclusion_evidence",
  snapshotFormatVersion: 1,
  conclusionId, experimentId, hypothesisId,
  conclusionType, conclusionStatus, confidence,
  confidenceIsNotPValue,
  hypothesisStatement,              // 截断至 400 字符，超长如实标注
  primaryAnalysis: { analysisId, analysisType, effectLabel, effect, pValue, tStat,
                     sampleCount, minGroupSampleCount, groupCount, directionConsistency } | null,
  contributingAnalyses: [ { analysisId, analysisType, effectLabel, effect, pValue, sampleCount } ],
  contributingAnalysesTruncated,    // 条数超上限时如实标注
  contributingAnalysesCount,
  runResolution: { sourceResearchRunId, path, analysisIds, distinctRunIds, missingAnalysisIds },
  evidenceShape: { hasEvidence, topLevelKeys, ruleTraceCount, legacyAnalysesKeyUsed },
  policy,
  disclaimer,                       // 截断至 400 字符
  generatedFrom: "research_conclusion.evidenceJson"
}
```

**裁剪纪律**：`contributingAnalyses` 最多 20 条（`SOURCE_TRACE_MAX_CONTRIBUTING`），文本字段最多 400 字符（`SOURCE_TRACE_MAX_TEXT`）—— 超限**如实标注**（`contributingAnalysesTruncated` / 「已截断，原长 N」），**不静默发生**。

**键名以真实库为准**（实查 7 行 `research_conclusion.evidenceJson`）：`{ disclaimer, policy, hypothesisId, hypothesisStatement, primaryAnalysis, primarySelectionRule, contributingAnalyses, ruleTrace, confidenceBasis, confidenceIsNotPValue }`，其中 `primaryAnalysis` 可为 `null`；并保留对 legacy 键 `analyses[].analysisId` 的兼容读取。

---

## 8. `update()` 白名单（闭集）

位置：`candidateTypes.ts#assertCandidateUpdateWhitelist` + `service.update` 的**显式逐字段**构造。

**可写集合（闭集，唯一权威）**：

```ts
CANDIDATE_EDITABLE_FIELDS = [
  "name", "description", "entryRule", "filterRule", "exitRule", "riskRule", "parameterSpace",
] as const;
```

**闭集语义（`closed by default`）**：校验实现是「**凡不在此列的键一律拒绝**」⇒ 将来给 Candidate 加字段时，**不显式加进白名单就不能被 API 修改**（006.2 §16 最后一句）。

**两道防线**：

1. **传输层**：zod `strictObject` ⇒ `{ status: … }` / `{ unknownField: … }` 在入参解析处即被拒（`unrecognized_keys` → BAD_REQUEST）。
2. **服务层**：`assertCandidateUpdateWhitelist` ⇒ 显式点名越界字段并**响亮失败**（`INVALID_INPUT`），**不静默丢弃**。

**实现形状即契约**：`service.update` **不是** `Object.assign` / spread，而是逐字段显式赋值：

```ts
const patch: StrategyCandidateUpdateInput = {};
if (input.name !== undefined) patch.name = assertCandidateName(input.name);
if (input.description !== undefined) patch.description = input.description;
if (input.entryRule !== undefined) patch.entryRule = input.entryRule;
// …其余 3 个草图字段
```

**一律拒绝**（`status` / `strategyDefinitionId` / `conclusionId` / `experimentId` / 4 个 `source*`）：

| 被拒字段 | 原因 |
| --- | --- |
| `status` | 状态迁移**只能**由 `transition()`（本 STEP）与未来 `promote()` 驱动；直接改 = 可伪造「已转正」 |
| `strategyDefinitionId` | 同上（结构锚，只有 promote 能写） |
| `conclusionId` / `experimentId` | 结构锚，写入后不得漂移 |
| `sourceDatasetVersionId` / `sourceResearchRunId` / `sourceTraceJson` / `sourceDatasetDivergenceReason` | **历史事实快照**，可改即等于伪造历史 |
| 任何**未来新增**字段 | 闭集默认拒绝 |

**空 patch 也拒绝**（`INVALID_INPUT`）—— 不返回「成功但没变」的假结果。

服务层之下，Research 仓储仍有 `assertCandidateUpdatePatchKeys` + `assertCandidateTransition` **再挡一次**（006.1 已落地，语义未改）。

---

## 9. `transition()` 状态机

- **复用既有状态机**（`researchCore/candidates.ts` 的 `isCandidateTransitionAllowed` / `CANDIDATE_TRANSITIONS`），**不新造第二套迁移表**（006.2 §17）。
- Candidate 六态不变：`DRAFT → REVIEW → ACCEPTED → CONVERTED → ARCHIVED`（+ `REJECTED`）。

**本 STEP 开放的目标（`CANDIDATE_TRANSITION_TARGETS`）**：

```ts
["REVIEW", "ACCEPTED", "REJECTED", "ARCHIVED"] as const;
```

**`CONVERTED` 不在其中**，且给出**专属错误码**（见 §10）。

**校验顺序与判据**：

1. `to === "CONVERTED"` ⇒ `CONVERSION_REQUIRES_PROMOTE`（架构裁定，先于一切）
2. `to` ∉ 目标白名单 ⇒ `TRANSITION_INVALID`
3. `candidateId` 非正整数 ⇒ `INVALID_INPUT`
4. 候选不存在 ⇒ `CANDIDATE_NOT_FOUND`
5. `current.status === to`（状态未变化）⇒ `TRANSITION_INVALID`（**不返回假成功**）
6. `isCandidateTransitionAllowed(current.status, to)` 为假（如 `DRAFT → ACCEPTED` 跳过 REVIEW；终态 `ARCHIVED` 之后不再迁移）⇒ `TRANSITION_INVALID`
7. 落库后复核新状态在 `RESEARCH_CANDIDATE_STATUSES` 内

⚠️ **已登记的行为边界**：状态机本身允许 `REVIEW → DRAFT`（退回），但**本 STEP 不暴露该目标**（与 006.0 §11.1 一致）。**「未开放」≠「已禁止」**，属 006.4 可重新裁定的范围 —— 已在代码注释中明写。

---

## 10. `CONVERTED` 拒绝规则（🔴 本 STEP 的核心纪律）

**三处入口全部拒绝**，且错误码为 `STRATEGY_CANDIDATE_CONVERSION_REQUIRES_PROMOTE`：

| 入口 | 路径 | 结果 |
| --- | --- | --- |
| `createFromConclusion` | 从不传 `status` ⇒ 恒 `DRAFT`，无法直达 | 结构性排除 |
| `update` | `status` 在非可写清单 ⇒ `INVALID_INPUT` | 拒绝 |
| `transition({ to: "CONVERTED" })` | 专属错误码 | 拒绝 |

**为什么给专属错误码而不是泛化的「非法迁移」**：「要走 promote」是一条**架构裁定**（`CONVERTED` 需要经 `build StrategyDefinition → validate → Dataset Registry 校验 → 写 Strategy Version`），不是一次普通状态机拒绝 —— 调用方需要看到这条信息。

**Router 层的刻意设计**：`transitionInput.to` 的 zod 枚举**故意包含 `"CONVERTED"`**：

```ts
to: z.enum(["REVIEW", "ACCEPTED", "REJECTED", "ARCHIVED", "CONVERTED"])
```

让它**走到 Service 的专属拒绝**，而不是被 zod 的「非枚举值」挡成一句泛化 BAD_REQUEST。

> 真实库实证：`REVIEW → CONVERTED` 与 `ACCEPTED → CONVERTED` 均返回 `STRATEGY_CANDIDATE_CONVERSION_REQUIRES_PROMOTE`，且拒绝后行仍为 `ACCEPTED`、`strategyDefinitionId` 仍为 `null`。

---

## 11. Router / API

位置：`server/research/strategyCandidate/router.ts`（199 行）；注册于 `server/researchRouter.ts`。

| 端点 | 类型 | 权限 |
| --- | --- | --- |
| `research.strategyCandidate.get` | query | `publicProcedure` |
| `research.strategyCandidate.createFromConclusion` | mutation | `adminProcedure` |
| `research.strategyCandidate.update` | mutation | `adminProcedure` |
| `research.strategyCandidate.transition` | mutation | `adminProcedure` |

- **API 名称按 §30 使用 `research.strategyCandidate.*`**。
- **与 `research.strategy.*` 并列**，不是它的替代：`strategyCandidate` 管「研究发现的取舍登记」，`strategy` 管「已转正的策略本体」。
- **Router 只做**输入校验 / 权限 / 调 Service / 输出 DTO —— Conclusion 查询链、Dataset 解析、Evidence 解析、Candidate 映射、状态机**全部**在 Service（006.2 §20）。
- **权限复用既有体系**（读 public、写 admin），**不新造**权限模型。
- **不存在 `promote`**（由测试断言 procedures 集合中不含 `research.strategyCandidate.promote`）。

### 领域错误 → tRPC code 映射

| 领域错误码 | tRPC code |
| --- | --- |
| `CONCLUSION_NOT_FOUND` / `EXPERIMENT_NOT_FOUND` / `CANDIDATE_NOT_FOUND` / `DATASET_VERSION_NOT_FOUND` | `NOT_FOUND` |
| `CONCLUSION_NOT_CANDIDATE_ELIGIBLE` / `DATASET_VERSION_NOT_READY` / `DATASET_VERSION_INVALID` | `PRECONDITION_FAILED` |
| `CANDIDATE_ALREADY_EXISTS` / `CONVERSION_REQUIRES_PROMOTE` / `TRANSITION_INVALID` | `CONFLICT` |
| `INVALID_INPUT` | `BAD_REQUEST` |
| 仓储 `ResearchReferenceError` | `NOT_FOUND` |
| 仓储 `ResearchCandidateError` | `BAD_REQUEST` |
| 仓储 `ResearchConflictError` | `CONFLICT` |

---

## 12. 测试

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `service.test.ts` | **49** | §23 createFromConclusion 12 例；§24 update 白名单逐字段拒绝；§17 transition 含三处 → CONVERTED 全拒绝；§14 get；§28/§29/§34 全局不变量 |
| `router.test.ts` | **12** | 端点集合 / 权限 / zod 输入校验 / 错误映射 / NOT_FOUND / 端到端效果 |
| `importBoundary.test.ts` | 8（006.1 六例 + **006.2 追加两例**） | 见下 |
| `provenance.test.ts` | 4（006.1 既有，未改） | provenance 仓储 |

**006.2 新增合计 = 49 + 12 + 2 = 63 例**（`service.test.ts` 49 + `router.test.ts` 12 + `importBoundary.test.ts` 追加 2）。

### `importBoundary.test.ts` 追加的两条（§21 / §22 / §28）

1. **桥在 006.2 阶段不得 import Strategy 领域** —— `server/research/strategyCandidate/**` 不得出现 `strategyPersistence` / `strategySchema` 的 import 说明符（promote 属 006.3）。
2. **桥不得出现写 `strategies` / `strategy_versions` 的痕迹** —— 扫描桥的**生产源文件**（**跳过 `.test.ts` 自身**）不得出现 `strategyVersions` / `strategyVersionDatasets` / `INSERT INTO strateg`。

### `router.test.ts` 的一个实现教训（已登记）

tRPC v11 的 caller 是 **Proxy** —— 访问任何不存在的属性（如 `anyCaller.promote`）都会触发「无 procedure」的**未处理 Promise rejection**（会造成 4 个 unhandled errors、2 例假失败）。**修复**：改用扁平点分路径表 `Object.keys(router._def.procedures)`（格式为 `research.strategyCandidate.get`），断言 procedures 集合与 `not.toContain("research.strategyCandidate.promote")`。

---

## 13. 真实 TiDB 验收

脚本：`scripts/verifyStrategyCandidateService.mts`（609 行，**自建自清**）。
命令：`npx tsx scripts/verifyStrategyCandidateService.mts`
结果：**RC = 0，39 ✓ / 0 ✗**。

**关键项**：

| 项 | 证据 |
| --- | --- |
| 真实坐标发现（只读） | `conclusion 360001`（DRAFT）→ `experiment 240002` → `dataset version 390002`（`v2` / READY） |
| 裸 SQL 独立算期望 Run | `analysisIds=[420005,420001,…,420007] → distinctRunIds=[480001]` |
| C1 真实落库 | `candidate id = 120001`，`status=DRAFT`，`sourceDatasetVersionId=390002`，`sourceResearchRunId=480001`（**与裸 SQL 独立结论一致**） |
| C1 快照自洽 | `snapshotKind = research_conclusion_evidence`；`primaryAnalysis.analysisId = 420005`（与真实 evidence 一致） |
| C1 裸 SQL 复核 | 行存在；落库字段与领域一致；`sourceTraceJson` 是合法 JSON 且含 `runResolution` |
| C2 负例（Conclusion 不存在） | `STRATEGY_CANDIDATE_CONCLUSION_NOT_FOUND` |
| C3 重复登记（同结论 + 同名） | `STRATEGY_CANDIDATE_ALREADY_EXISTS` |
| C4 Dataset Version 不存在 / 未 READY / overrides 携带 `datasetVersionId` | `DATASET_VERSION_NOT_FOUND` / `DATASET_VERSION_NOT_READY` / `INVALID_INPUT` |
| C4 负例全过程**零新增行** | `1 → 1` |
| C5 草图字段真实更新 | `[VERIFY-0062] 已改名` 已落库；**来源快照与状态未动** |
| C5 越界拒绝 | 带 `status` / `sourceResearchRunId` ⇒ `INVALID_INPUT`；拒绝后**行内容零变化** |
| C6 真实迁移 | `DRAFT → REVIEW` 落库；裸 SQL 复核为 REVIEW |
| C6 🔴 CONVERTED 拒绝 | `REVIEW → CONVERTED` 与 `ACCEPTED → CONVERTED` **均** `CONVERSION_REQUIRES_PROMOTE`；拒绝后仍 `ACCEPTED`、`strategyDefinitionId: null` |
| C6 未开放目标 | 目标 `DRAFT`（未开放）⇒ `TRANSITION_INVALID` |
| C7 Run 不可解析 ⇒ NULL | `sourceResearchRunId = null`，快照如实记录 `missingAnalysisIds` |
| 自建自清 | 无残留候选行 `[]` |

> ⚠️ **C3b 诚实登记**：真实库当前**无 `SUPERSEDED` 结论**（`SUPERSEDED` 无写入路径）⇒ 该负例分支**仅由单测覆盖**，不假装它在真实数据上被验证过。

> ⚠️ **进程退出问题（已修）**：drizzle 连接池不随 `conn.end()` 关闭，脚本首次运行时进程不退出（跑了 15 分钟被 kill）⇒ 改为 `process.exit(failures.length > 0 ? 1 : 0)`，与 006.1 同款问题（已在代码注释登记）。

---

## 14. 行数守恒（before / after）

验收脚本在**执行前**与**执行后**各读一次 21 张表的行数，逐表比对。

**前状态（真实 TiDB）**：

```
research_experiment 2 · research_hypothesis 0 · research_run 9 · research_analysis 26 ·
research_analysis_condition 14 · research_analysis_metric 0 · research_result 841 ·
research_conclusion 8 · research_strategy_candidate 0 · research_artifact 0 ·
research_analysis_template 0 · research_analysis_template_item 0 ·
strategies 0 · strategy_versions 0 · strategy_version_datasets 0 ·
strategy_parameters 0 · strategy_entry_rules 0 · strategy_exit_rules 0 ·
strategy_execution_rules 0 · strategy_research_provenance 0 · dataset_version 2
```

**结果**：`行数守恒：全部 21 张表前后一致 — 21/21`，`research_conclusion 8 → 8`（本步**只读引用**用户既有结论，不改上游）。

> ⚠️ **如实登记**：本 STEP 实施期间，**另一条工作线**（RESEARCH-009 分析建设线，建 Run `480001`）在真实库上新增了数据（相对 006.1 时点：`research_result 674 → 841`、`research_conclusion 7 → 8`、`research_run 8 → 9`、`research_analysis 19 → 26`）。验收脚本因此**动态发现**当前真实坐标（`conclusion 360001 → experiment 240002 → dataset version 390002 → run 480001`），而**不是**硬编码旧值 —— 这不是本 STEP 的写入，本 STEP 的写入严格限于自建自清的那 1 行候选。

---

## 15. Strategy 表零写入证明（§28 / §29）

| 断言 | 证据 |
| --- | --- |
| `strategy_versions` 始终 **0 行** | `0 → 0` |
| `strategies` / `strategy_version_datasets` / `strategy_research_provenance` 均 **0 行** | `{ strategies: 0, datasets: 0, provenance: 0 }` |
| 桥不 import Strategy 领域 | `importBoundary.test.ts` 新增断言 ① |
| 桥无写 Strategy 表痕迹 | `importBoundary.test.ts` 新增断言 ②（扫生产源文件） |
| 无 `promote` 端点 | `router.test.ts` 断言 procedures 集合不含 `research.strategyCandidate.promote` |
| 全局不变量测试 | `service.test.ts` 末例：无论怎样操作，Service 都不产出 `CONVERTED`、不写 `strategyDefinitionId` |

**本 STEP 的全部写入面 = 仅 `research_strategy_candidate` 表**（且仅经 `repos.candidates.create` / `update`）。

---

## 16. 未实施（明确留给 006.3 / 006.4 / 006.5）

| 项 | 归属 |
| --- | --- |
| `promote()` —— Candidate → Strategy（ACCEPTED 断言 → 幂等闸门 → build definition → validate → Registry 校验 → `StrategyService.create` + `createVersion` → 写 provenance → 回写 `CONVERTED`） | **006.3** |
| `definitionBuild` —— 唯一显式转换器（Conclusion 草图词表 → StrategyDefinition 词表） | **006.3** |
| `cloneVersion` 继承 provenance | **006.3** |
| 向 `strategy_research_provenance` 写入 | **006.3** |
| `StrategyProvenancePort` 可选注入到 `StrategyService` | **006.3** |
| Candidate 前端（登记按钮 / 编辑流程 / 列表） | **006.4** |
| Provenance UI | **006.4** |
| Backtest / Parameter Search / OOS / WFO / Robustness / Overfitting | 后续 STEP |
| `REVIEW → DRAFT` 退回目标是否开放 | 006.4 可重新裁定 |

**本 STEP 未修改**：Dataset Registry / StrategyDocument / `StrategyService` / Strategy Persistence / `strategy_versions` schema / `strategy_version_datasets` schema（006.2 §3）。

---

## 17. Known Limitations / 发现的问题

1. **`SUPERSEDED` 负例无法在真实数据上验证** —— 真实库 8 行结论全 `DRAFT`（结论 `status` 目前无写入路径，006.0 §4.1 B2）。该分支仅由单测覆盖。**不假装已验证**。
2. **`FINAL` 资格分支同理** —— 白名单含 `FINAL`，但真实库无 `FINAL` 结论 ⇒ 该分支仅由单测覆盖（`service.test.ts` 2b）。
3. **`sourceResearchRunId` 可能为 NULL** —— 这是**设计使然**（提不出即如实承认），不是缺陷。跨 Run 结论 / 缺失 analysis 都会导致 NULL，且快照如实记录原因。
4. **`REVIEW → DRAFT` 未开放** —— 状态机允许，但本 STEP 不暴露。属「未开放 ≠ 已禁止」，留待 006.4 裁定。
5. **跨存储事务缺口尚未出现但已可预见** —— 006.3 的 promote 需要在 Strategy 事务与 Research 库之间做两次写，**非原子**。本 STEP 不涉及，但 006.1 与 006.0 已登记该缺口（promote 失败须抛 `PROMOTE_WRITEBACK_FAILED` 并带已生成的 `strategyId`，由幂等闸门兜底）。
6. **`research_result` 非 immutable** —— 006.0 已登记（`engine.ts` 重算即替换）⇒ 这就是 `sourceTraceJson` 必须以**快照**而非 FK 存在的原因。本 STEP 的快照策略正是对该缺陷的应对。
7. **`agent-browser` 在本机不可用** —— 前端验收不用浏览器截图；本 STEP 无前端，故不受影响。

---

## 附：文件清单

### 新增（7 个源文件 + 2 个测试 + 1 个脚本）

| 文件 | 行数 | 说明 |
| --- | --- | --- |
| `server/research/strategyCandidate/candidateTypes.ts` | 214 | 应用层类型 / 错误码 / 写入白名单权威源 |
| `server/research/strategyCandidate/evidenceTrace.ts` | 267 | 证据解析 + 最小快照构造（纯函数） |
| `server/research/strategyCandidate/service.ts` | 450 | `StrategyCandidateService` |
| `server/research/strategyCandidate/datasetVersionPort.ts` | 34 | Registry 只读端口实现 |
| `server/research/strategyCandidate/router.ts` | 199 | `research.strategyCandidate.*` |
| `server/research/strategyCandidate/service.test.ts` | 758 | 49 例 |
| `server/research/strategyCandidate/router.test.ts` | 269 | 12 例 |
| `scripts/verifyStrategyCandidateService.mts` | 609 | 真实 TiDB 验收（39 项） |
| `docs/evidence/_r0062_probe.mjs` / `docs/evidence/_r0062_probe_result.md` | — | 前状态只读审计（含真实 evidenceJson 形状） |

### 修改（3 个）

| 文件 | 改动 |
| --- | --- |
| `server/research/strategyCandidate/index.ts` | barrel 扩展：新增导出 `./candidateTypes` / `./evidenceTrace` / `./service`；**刻意不导出** `router.ts`（传输层）与 `datasetVersionPort.ts`（直连 Registry），避免单测被动拉起 DB |
| `server/research/strategyCandidate/importBoundary.test.ts` | 追加 `describe("RESEARCH-006.2 桥边界追加守护（§21 / §22 / §28）")` 两例 |
| `server/researchRouter.ts` | 新增 `strategyCandidate: strategyCandidateRouter` 注册（与 `strategy` 并列，附注释说明不提供 promote） |

### 证据文件

`docs/evidence/_r0062_verify.log`（真实库 39 项验收）、`docs/evidence/_r0062_fulltest.log` / `docs/evidence/_r0062_fulltest.clean.log`（全量测试）。

---

## 附：验收汇总

| 项 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **RC = 0** |
| 聚焦（`strategyCandidate` + `researchCore` + `strategyPersistence` + `datasetRegistry`） | **26 文件 / 484 例全过** |
| 桥目录聚焦 | **4 文件 / 73 例全过** |
| 全量 `npx vitest run` | **7 failed / 215 passed（222 文件）**；**15 failed / 3538 passed（3553 例）** |
| 全量新增 | 相对 006.1（3490 例）**+63 例** |
| baseline 对比 | 失败文件逐项计数**完全一致**：`dataHealth` 1 / `image.uploadAndRecognize` 1 / `limitUp` 1 / `limitUp.watch` 4 / `marketData` 4 / `tushare.secret` 1 / `tushareTradingCalendar` 3 ⇒ **零新增失败** |
| 真实 TiDB 验收 | **RC = 0，39 ✓ / 0 ✗** |
| 行数守恒 | **21/21 张表前后一致** |
| `strategy_versions` | **0 → 0** |
