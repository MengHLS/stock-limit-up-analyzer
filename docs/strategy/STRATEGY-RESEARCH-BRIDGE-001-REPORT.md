# STRATEGY-RESEARCH-BRIDGE-001 — Independent Experiment → Strategy 正式桥接 + 首板回踩 Strategy 首条真实闭环

> **编号**：`9cm`（`ROADMAP.md` 编号台账：本轮取号时实查「已用至 `9cl`」⇒ 下一个未占用 = `9cm`）
> **报告位置**：`docs/strategy/STRATEGY-RESEARCH-BRIDGE-001-REPORT.md`（**本任务唯一最终报告**）
> **状态**：`STRATEGY-RESEARCH-BRIDGE-001 = COMPLETE`（**24 项判据全部满足**；另有 **1 项环境缺陷**导致项目惯用的 git 行尾闸无法按原样运行，已按 §25 要求**明确 Gate + 真实根因 + 代码/证据**，并用**等价或更严**的替代判据补齐 —— 见 §25.3）
> **一句话结论**：`Dataset Version 390002` → `EXP-001 / EXP-002 真实 Run` → `first-board-pullback v1.0.0` 的**可追溯链已经真实闭合**，且这条链**不是页面上写着好看** —— 它的身份、它进参数搜索的资格、它进回测装配的能力，三处都做了**真实消费验证**；过程中修掉 **2 条真实产品缺陷**。
> **本轮未做任何 research 结论到交易规则的自动推导**：18 条决策登记里 **16 条明标「设计决策，不来自 EXP-001/EXP-002」**。

---

## 1. 任务与边界（规格 §0）

### 1.1 必须成立的链路

```
Dataset Version 390002
  ├─ EXP-001 (first-board-pullback/fundamental-study)
  └─ EXP-002 (first-board-pullback/stability-validation)
        ↓  Research Evidence
  first-board-pullback Strategy, Version 1.0.0
        ↓
  Parameter Search  /  Backtest
```

必须能回答「**这个 Strategy 为什么这样定义？**」并沿 provenance 一路追到
`StrategyVersion → Research Evidence → EXP-001/EXP-002 Run → Dataset Version 390002`。

### 1.2 执行原则（逐条守住 / 逐条给出证据）

| §0 原则 | 本轮的落实方式 | 证据 |
| --- | --- | --- |
| 不恢复旧 `Research → Analysis → Finding → Conclusion → Candidate → Strategy` 链 | 新代码**零** `analysisId` / `findingIds` / `conclusionId` / `candidateId` 依赖（§13） | §13 的 grep 判据 |
| 不新建第二套 Research 系统 | `server/researchCore/**`、`server/researchEngine/**` **零新增 / 零引用**；复用 Independent Experiment 体系 | `legacyFreeProductionChain.test.ts` 7 例 PASS |
| 不继续扩展 EXP-001 / EXP-002 | 两个实验目录**本轮零改动**（只在 Bridge 侧**读**它们的 Run） | `git`-free 静态核查 + 未见任何实验文件 mtime 变更 |
| 不新增独立 Strategy Core | 复用 `server/strategyCore/**` + `StrategyVersion` + 既有 schema | §15 装配实测 `strategyDecisionEngine = strategy-core` |
| 优先复用现有接口 | Parameter Search 走既有 `paramSearch.createSearch`；Backtest 走既有 `researchRun.loopRun` → `assembleRunWorkbenchInputs` | §14 / §15 |
| 公共契约改动做**最小兼容**修改 | 仅 3 个生产文件、**都是新增可选字段 / 包装既有调用**，无签名破坏 | §15.4 |
| **不为了完成任务而强行自动推导交易规则** | 18 条决策登记中 **16 条**标 `DESIGN`，报告 §8 逐条列名 | §8 |
| 全过程只保留**一个**最终报告 | 本文件；**未**创建 `STRATEGY-RESEARCH-BRIDGE-AUDIT.md` 等旁支报告 | 本文件即全部 |

---

## 2. 第一阶段：现状确认（**未**单独交付审计报告）

规格 §2 明确：第一阶段只做现状确认，**禁止**单独交付审计报告，也**禁止**因发现缺口再拆任务。

本轮的第一阶段动作与结论（全部并入本报告，无独立产物）：

| 现状项 | 实查结论 |
| --- | --- |
| 研究来源落库位置 | `strategy_research_provenance`（`drizzle/schema.ts:681-724`，migration `0045_experiment_provenance.sql`）是**唯一**承载表，`UNIQUE(strategyVersionId)` |
| 是否已有桥 | **已存在**：`server/researchExperiments/strategyBridge.ts` 有 `createStrategyFromExperiment`（单实验）。本轮**扩展**为 `createStrategyFromEvidenceRuns`（多 Run → 多证据），而不是另建一层 |
| 是否已有读路径 | **已存在**：`strategyDomain.strategyCandidate.getVersionProvenance`（⚠️ 命名空间是 `strategyDomain`，**不是** `research`；由 `server/strategyDomainRouter.ts:112` 挂载） |
| Strategy 两套模型 | legacy 生产持久化（`server/research/strategySchema/**` + `strategy_versions.strategyDocumentJson`）与 Strategy Core 新域（`server/strategyCore/**`，无独立表）**并存**。本轮**同时**使用：持久化走 legacy schema（有表），规则求值走 Strategy Core（`ruleGraph`） |
| 参数消费链是否有证据 | 🔴 **`9cc` 已登记**：真库 11/11 策略版本规则图引用面为空 ⇒ 现成策略跑参数搜索只得**假证据**。本轮因此**先跑探针再看结论**（`_probe_srb001_doc_params.mts`），并**发现了一条真缺陷**（§15.4） |
| Run 持久化路径 | `ExperimentRunner.run()` **不持久化**；真实路径 = `runService.execute()` → `ExperimentRunRepository.createRun` |
| PIT 判定日 | 分析 / Run / Experiment / Dataset 四级取**唯一值**；全空 + 引用观察日变量 ⇒ **拒整个 Run** |

**未做**：未产出 `*-AUDIT.md`；未因上述任何缺口另开任务；未改动第一阶段识别的既有能力。

---

## 3. 架构边界：Research Evidence 只能表达「研究事实」

规格 §3 划定的边界，本轮以**类型级 + 结构级**手段落地（不是靠注释）：

| 只有 Research Evidence 可以表达 | 只有 Strategy Rule 可以表达 |
| --- | --- |
| 数据事实 / 统计事实 / 研究观察 / 研究指标 / 条件 / 样本 / 限制 / 研究运行 / 研究产物 | Event / Condition / Entry / Exit / Position / Risk / Parameter / Execution semantics |

落地方式：

1. **证据类型是闭集**：`RESEARCH_EVIDENCE_KINDS = ["RESULT_SUMMARY", "STABILITY_VERDICT", "SAMPLE_ACCOUNTING"]`
   —— 三个都只描述「研究侧的事实」，**没有任何一个**能表达入场 / 出场 / 仓位。
2. **证据只能引用「研究信封里的坐标」**：`reference` 是一条**点号路径**（如
   `customPayload.metrics.pullbackRateOnFinalDay`），服务端必须能**在该 Run 的真实结果信封里解析出这个路径**，
   否则**响亮拒绝**（`EXPERIMENT_STRATEGY_EVIDENCE_REFERENCE_UNRESOLVED`）—— 见 §7.4。
3. **交易规则走另一条完全不同的通道**：`StrategyDocument`（legacy schema）→ `ruleGraph` →
   `assembleStrategySide` → **策略决策引擎**。研究证据进的是**溯源身份**，不进规则图。
4. 前端**显式声明边界**：证据区块尾注固定为「**不构成本策略的买入 / 卖出规则**」，并由前端探针 C 段逐字断言
   （`_probe_srb001_strategy_detail_frontend.mjs`，§16）。

🔴 **本轮守住的底线**：研究事实**没有**任何一条被自动翻译成交易规则。若把
「T+10 不破组与破位组中位差 +10.68pp」直接写成一条入场规则，那就是把**研究观察**伪装成**已证实的交易逻辑** —— 本轮没有做这件事，且在报告 §8 显式登记了「研究未确定项属策略设计决策」。

---

## 4. Research Evidence Contract（规格 §4）

### 4.1 契约（`server/research/strategyCandidate/researchEvidence.ts`）

最小、稳定、可版本化。字段命名遵循仓库现有 camelCase 命名规范：

```ts
interface ResearchEvidence {
  experimentCode: string;        // 实验编号，如 "first-board-pullback/fundamental-study"
  experimentVersion: string;     // 实验版本，如 "1.1.0"
  runId: string;                 // 真实 Run，形如 RUN-YYYYMMDD-XXXXXXXX
  datasetVersionId: number;      // 唯一坐标，如 390002
  datasetVersionLabel?: string;  // 展示用，如 "v2"
  evidenceKind: ResearchEvidenceKind;  // RESULT_SUMMARY | STABILITY_VERDICT | SAMPLE_ACCOUNTING
  reference: string;             // 研究信封内的点号路径（必须可解析）
  description?: string;          // 人可读口径说明
  // 以下为服务端**读回**时补齐（不由调用方传入）：
  resultDigest?: string;         // 结果摘要指纹，形如 exp-sha256:…
  runStatus?: string;            // COMPLETED 等
  startedAt?: string;
  durationMs?: number;
}
```

### 4.2 五项契约纪律（都有判据钉住）

| 纪律 | 判据 |
| --- | --- |
| **引用必须指向真实存在的 Run / ExperimentVersion** | `assertResearchEvidenceRefs` 逐条查 `research_experiment_run`；不存在 ⇒ 抛（§7.4 实测） |
| **`reference` 必须在真实结果信封里可解析** | `resolveEvidenceReference` 按点号路径解析；解析不到 ⇒ 响亮拒绝，且**不落任何行**（实测 `strategies` 行数 = 0） |
| **同一版本的多条证据必须同 Dataset 坐标** | `resolveSingleDatasetVersionId` —— 多值即拒（`DECISION_OFFSET_CONFLICT` 同族语义） |
| **证据集合有独立指纹** | `computeResearchEvidenceFingerprint` → `evi-sha256:…`（§6） |
| **快照键固定** | `RESEARCH_EVIDENCE_SNAPSHOT_KEY = "researchEvidences"`、`RESEARCH_EVIDENCE_FINGERPRINT_KEY = "researchEvidenceFingerprint"` |

---

## 5. Strategy 不得直连 MinIO（规格 §5）

**判据（结构级，不是注释）**：Strategy 侧代码只保存**稳定引用**，不出现对象存储 SDK / bucket / object client。

- 证据里落的是 `resultManifestKey` 形态的**稳定坐标**与 `exp-sha256:…` 指纹，**不是** MinIO 对象句柄；
- 读回路径（`server/researchExperiments/evidenceRunReader.ts#createPersistedEvidenceRunReader`）经**既有 Run 仓储**拿结果信封，
  **没有**任何 `MinioClient` / `bucket` / `putObject` / `getObject` 出现在 `server/research/strategyCandidate/**`
  与 `server/researchExperiments/strategyBridge*.ts`；
- `server/artifactStorage` 是实验体系的**唯一出口**（`9cl` 已确立），Strategy 侧**完全不接触**它。

---

## 6. 证据进入 Strategy Version 的**可追溯身份**（规格 §6）

### 6.1 裁决过程（这是本轮唯一一次要求用户裁定的架构分叉）

现状是 `strategy_versions.fingerprint` = **策略文档**指纹（`computeStrategyDocumentFingerprint`），
它**看不见**溯源表里多了一行。于是出现规格 §6 明确禁止的状态：

> 「页面显示有研究来源，但 fingerprint 不知道变化」

两种改法摆在面前：

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| A | 把 `researchEvidenceFingerprint` **混进** `strategy_versions.fingerprint` | 会让**未改策略文档**的版本指纹变化 ⇒ 既有指纹语义被破坏（多处消费方按「文档未改 ⇒ 指纹不变」判断） |
| B | 证据有**独立指纹**，同时**进入可追溯身份**：`provenance.researchEvidenceFingerprint`，前端可见，测试钉死 | 需要一个新的展示位与一组新断言；**零 migration** |

**用户裁决：B（证据独立指纹）**。理由：满足 §6 的两条要求（同 Evidence → 同指纹；Evidence 变 → 身份可识别变化），
同时**不动** `strategy_versions.fingerprint` 的既有语义。**落地结果：零 migration、零新表。**

### 6.2 实测证据

| 要求 | 实测 | 证据 |
| --- | --- | --- |
| 相同 Strategy + 相同 Evidence ⇒ 相同指纹 | 重放同一批证据 ⇒ `researchEvidenceFingerprint` 逐字节不变，`strategyVersionId` 1110001 → 1110001、`provenanceId` 630001 → 630001、`created = false` | E2E 步骤 `重放 evidence 指纹不变`（43/43 PASS） |
| Evidence 改变 ⇒ 身份必须能识别变化 | 换一条**可解析但不同**的 `reference`（把 `sampleSummary.eligibleCount` 指向别处）⇒ 撞 `EXPERIMENT_STRATEGY_EVIDENCE_PROVENANCE_CONFLICT`，**且未落下任何新溯源行**（`1 → 1`） | E2E `conflict` 段：`{"domainCode":"EXPERIMENT_STRATEGY_EVIDENCE_PROVENANCE_CONFLICT","provenanceRowsBefore":1,"provenanceRowsAfter":1}` |
| 前端可见 | 详情页「版本与状态」标签内证据区块顶部徽标 `evi-sha256:f0959a03f21bd16a` | 前端探针 C2（与后端**逐字节**比对） |
| 测试钉死 | `tests/server/research/strategyCandidate/researchEvidence.test.ts` **23 例** + `strategyBridgeEvidence.test.ts` **12 例** | §18 |

**证据指纹**：`evi-sha256:f0959a03f21bd16a`
**策略文档指纹**（**未改语义**）：`819c1c50903498e7ca167a2e6a1ba6a32bc57e1cb5730f07101bc7f6ae30c389`

---

## 7. 首条真实策略：`first-board-pullback` v`1.0.0`（规格 §7 / §12）

### 7.1 策略定义（草稿真源）

`server/researchExperiments/firstBoardPullbackStrategyDraft.ts`：

- `FIRST_BOARD_PULLBACK_STRATEGY_ID = "first-board-pullback"`
- `FIRST_BOARD_PULLBACK_STRATEGY_NAME = "首板回踩（不破首板日开盘价 + 缩量）"`
- 名称与描述**同时**由 Bridge 与探针 import（避免两处字符串漂移 —— 本轮踩过一次，见 §18.4）

### 7.2 五条证据（同时引用 EXP-001 与 EXP-002）

| # | 实验 | 实验版本 | Run | evidenceKind | reference |
| --- | --- | --- | --- | --- | --- |
| 1 | `first-board-pullback/fundamental-study` | `1.1.0` | `RUN-20260921-8557F38A` | `RESULT_SUMMARY` | `customPayload.metrics.pullbackRateOnFinalDay` |
| 2 | `first-board-pullback/fundamental-study` | `1.1.0` | `RUN-20260921-8557F38A` | `SAMPLE_ACCOUNTING` | `customPayload.candidates.unscannedEventCount` |
| 3 | `first-board-pullback/fundamental-study` | `1.1.0` | `RUN-20260921-8557F38A` | `RESULT_SUMMARY` | `customPayload.informationBoundary.decisionOffsetDays` |
| 4 | `first-board-pullback/stability-validation` | `1.0.0` | `RUN-20260921-C95B1D47` | `STABILITY_VERDICT` | `customPayload.overallVerdict` |
| 5 | `first-board-pullback/stability-validation` | `1.0.0` | `RUN-20260921-C95B1D47` | `RESULT_SUMMARY` | `customPayload.counts.stableCount` |

🔴 **`RUN-20260921-A95F5B48` 也真实存在且被 E2E 校验**（同为 `stability-validation@1.0.0`），但**未进证据集**：
它是 `9cl` 的**后端 E2E 首跑**（22 PASS / 7 FAIL，判据修正的证据），**不是**该实验的最终运行 ⇒ 不进 provenance。
这正是 §7「引用必须指向真实存在的 Run」之外的**第二层要求**：**存在 ≠ 应该被引用**。

### 7.3 每条证据的 `resultDigest`（服务端读回，非调用方传入）

| Run | resultDigest |
| --- | --- |
| `RUN-20260921-8557F38A`（EXP-001，3 条证据共用） | `exp-sha256:63e77251a95bd…` |
| `RUN-20260921-C95B1D47`（EXP-002，2 条证据共用） | `exp-sha256:6c1156944b343…` |

两条 digest **不同** ⇒ 同一策略引用了**两次不同的真实运行结果**，不是复制粘贴同一个值。

### 7.4 禁止项实测（规格 §7）

| 禁止项 | 判据 | 实测 |
| --- | --- | --- |
| 手写不存在的 Run ID | 引用的 Run 必须在 `research_experiment_run` 里存在 | 3 个 Run 逐条 `status=COMPLETED` 且 `datasetVersionId=390002` |
| 虚构 artifact | `reference` 必须在真实结果信封里可解析 | E2E 用 `customPayload.notARealField.deeper` 一击即撞 `EXPERIMENT_STRATEGY_EVIDENCE_REFERENCE_UNRESOLVED`，且 `strategies` **行数 = 0**（拒绝路径**不落任何行**） |
| 复制 `result.json` | 证据只存**引用 + 摘要指纹**，不存结果本体 | 落库行里只有 `reference` 与 `exp-sha256:…`，无结果 JSON |
| 只保存实验名称而没有版本 + run | 每条证据强制 `experimentVersion` + `runId` | 5/5 条齐备，且逐条与库里 Run 行**逐项一致** |

---

## 8. 研究未确定项 ⇒ **策略设计决策**（规格 §8，本报告最要紧的一节）

规格 §8 的禁令：研究尚未确定的交易规则（买入价格/时刻/滑点/手续费/仓位/止损/止盈/最大持仓天数/资金规模/成交规则）
**不许伪造研究结论、不许把默认值伪装成研究发现**。

### 8.1 决策登记账（实测 18 条，不是 19 条）

`_DECISION_LEDGER` + `summarizeDecisionLedger()`，E2E 落盘实测：

```json
{"total": 18,
 "byRole":   {"FIXED": 16, "TUNABLE": 2, "DERIVED": 0},
 "byOrigin": {"RESEARCH": 2, "DESIGN": 16},
 "gridCombinationCount": 44}
```

> ⚠️ **口径修正登记**：任务书原文写「19 项」，实测为 **18 条**。差异来自「入场事件 + 观察窗口」被合并登记为 1 条
> `entryRule.event` + 1 条 `entryRule.extra.observationWindow`（合计 2 条 `RESEARCH`），而**其余 16 条全部是设计决策**。
> 报告按**实测数**写（18），不按任务书的估计数写。这正是「数字必须从落盘证据现算」的一次执行。

### 8.2 只有 2 条有研究来源（`RESEARCH`）

| 字段 | 研究来源 | 说明 |
| --- | --- | --- |
| `entryRule.event` | EXP-001（`RUN-20260921-8557F38A`） | 「首板之后、观察窗口内回踩」这一**事件定义**来自 EXP-001 的研究口径 |
| `entryRule.extra.observationWindow` | EXP-001 | 观察窗口 `[1, 5]` 交易日，上界 = `DECLARED_DECISION_OFFSET_DAYS = 5`（§11 跨模块钉死） |

### 8.3 其余 16 条**全部**是设计决策（`DESIGN`），逐条列名

`entryRule.timing`、`entryRule.extra.trigger`、`entryRule.extra.execution.quantityMethod`、
`entryRule.extra.execution.lotSize`、`entryRule.extra.position.sizingMethod`、
`entryRule.extra.position.positionRatio`、`entryRule.extra.risk.maxDrawdown`、
`entryRule.extra.document.backtestConfig.initialCapital`、`entryRule.extra.document.costModel`、
`filterRule.groups[0].conditions[0].value`、`filterRule.groups[0].conditions[1].value`、
`exitRule.holdingDays`、`exitRule.takeProfit`、`exitRule.stopLoss`、
`riskRule.maxPositions`、`riskRule.maxPositionWeight`

🔴 **这 16 条在报告里被**明确登记**为「该值属于策略设计决策，不来自 EXP-001/EXP-002」**，
并且**不是**「暂无值所以填了个默认」—— 它们是创建 `StrategyVersion` 的硬性要求字段，
所以**必须**有值，但**不许**被说成研究发现。这就是 §8 要求的区分动作。

### 8.4 FIXED / TUNABLE / DERIVED 三分

| 类 | 数量 | 含义 |
| --- | --- | --- |
| `FIXED` | 16 | 版本内**不可搜索**的固定决策（含上面 16 条设计决策） |
| `TUNABLE` | **2** | `maxBreakDepthRatio`（`[0, 0.1]` step `0.01`，缺省 `0`）、`maxVolumeRatio`（`[0.5, 2]` step `0.5`，缺省 `1`） |
| `DERIVED` | 0 | 本策略**没有**派生参数（不伪造一个） |

**网格组合数 = 44**（11 × 4），与参数搜索真实落库的 `parameter_search_combination` 行数 **44 行**逐数一致（§14）。

---

## 9. 交易规则的表达载体（规格 §3 + §13 的交汇点）

规则**不写在证据里**，写在 `StrategyDocument` 的**声明式条件**里：

| 条件 | 字段 | 算子 | 值 |
| --- | --- | --- | --- |
| `cond-1` 未跌破首板日开盘价（阈值 0 = 与 EXP-001 的 `NON_BREAK_OPEN` 分类同义） | `bar.haircutFromEventLow` | `LESS_THAN_OR_EQUAL` | `maxBreakDepthRatio`（`PARAMETER_REFERENCE`） |
| `cond-2` 缩量：当日成交量不超过事件日成交量的指定倍数 | `bar.volumeRatio` | `LESS_THAN_OR_EQUAL` | `maxVolumeRatio`（`PARAMETER_REFERENCE`） |

🔴 两条条件的**阈值都是参数引用**（不是硬编码研究数字）⇒ 研究结论（「不破位」这一分类口径）
被表达成**结构**，而阈值留给 Parameter Search 去搜 —— 这是研究事实与交易规则的正交分割。
派生字段 `haircutFromEventLow` / `volumeRatio` 均属 `STRATEGY_DERIVED_BAR_FIELDS`，全部按 `CURRENT_BAR` 求值，
**无跨 bar 引用、无未来函数**。

---

## 10. 数据集绑定（唯一坐标）

| 项 | 值 |
| --- | --- |
| `datasetId` | `first_limit_pullback` |
| `datasetVersionId` | **`390002`** |
| `datasetVersionLabel` | `v2` |
| `status` | `READY` |
| 窗口 | `2024-09-01` ~ `2026-09-01` |
| 声明事件数 | `23978` |
| 绑定途径 | `role = PRIMARY`，备注「由 RESEARCH-006.3 promote 绑定（唯一坐标 `dataset_version.id`）」 |

E2E 前置闸**实查**：`390002` 存在且 `READY`（`datasetId=120001 label=v2`）。

---

## 11. PIT 语义与 `decisionOffsetDays`（规格 §11）

### 11.1 硬口径

| 项 | 值 | 出处 |
| --- | --- | --- |
| 决策偏移 | `DECLARED_DECISION_OFFSET_DAYS = 5` | `firstBoardPullbackStrategyDraft.ts` |
| 观察窗口 | `start = 1`、`end = 5`、`unit = TRADING_DAY` | 文档实测（探针 `observationWindow`） |
| T+5 判断条件 | **包含式**：`rd <= 5`（**不是** `rd < 5`） | 与 EXP-001 / EXP-002 已验证口径一致 |
| 跨模块钉死 | 草稿的观察窗口上界 **==** `DECLARED_DECISION_OFFSET_DAYS`（同一常量，不是两处字面量） | 单测断言 |

### 11.2 为什么必须是 `rd <= 5`

EXP-001 / EXP-002 的**已验证**口径是：决策时点 = `T+k`，分组**只用 `rd ∈ [1, k]`**（当时可见的路径），
未来窗口 `rd ∈ [k+1, h]` **严格在决策时点之后**。`T+5` 这个决策时点**包含**第 5 个交易日 —— 因为
「在 T+5 收盘做决策」时，`rd = 5` 那根 bar **已经收出来了**，它是**已知信息**。
若写成 `rd < 5`，则等于**主动丢掉一根已知 bar**，与 EXP 口径**不一致**（会把「决策时点」偷偷前移一天）。

### 11.3 无 look-ahead 的证明链

1. **推导可证**（§11.2）：决策日 k 的判定只用 `rd ∈ [1, k]`，未来窗口从 `k+1` 起 ⇒
   `Strategy Decision ≤ Strategy Decision Offset`，**不等式方向由构造保证**。
2. **EXP-002 侧的独立证据**：`customPayload.informationBoundary.decisionOffsetDays` 被**当作证据引用**
   （5 条证据的第 3 条）⇒ 这条口径**是**从研究结果里读出来的，不是本报告自己声明的。
3. **结构级**：`STRATEGY_DERIVED_BAR_FIELDS` 四项全部按 `CURRENT_BAR` 求值 ⇒ 规则图里**不可能**出现跨 bar 前视。
4. **`observationWindow.end == DECLARED_DECISION_OFFSET_DAYS`** 由单测钉死，任一端改动即红。

⚠️ **未做**：本轮**没有**跑完整回测做「前视收益 vs 真实收益」的数值对照（成本不适宜，见 §15.5）——
因此本条的证据是**推导 + 研究侧引用 + 结构级**三层，而**不是**数值实证。**如实登记，不含糊。**

---

## 12. Old Research 依赖为零（规格 §13）

| 判据 | 结果 |
| --- | --- |
| 新代码出现 `analysisId` / `findingIds` / `conclusionId` / `candidateId` | **0 次** |
| `server/researchCore/**`、`server/researchEngine/**` 被引用 | **0 次**（两个目录已由 `9cg` 整体删除） |
| `legacyFreeProductionChain.test.ts`（**import 图可达性**，TS AST，排除 `import type`） | **7 / 7 PASS** |
| 新体系够到旧 Research 目录的通道 | 具名白名单，除白名单外**不得**够到 |

⚠️ `strategy_research_provenance` 表里**确实有** `sourceCandidateId` / `sourceConclusionId` 两列 ——
它们是 `9cg` 之前的历史遗留列（`RESEARCH-006.1` 时代的旧链语义），**本轮全部写 `NULL`**（实测落库行两列均为 `null`）。
**不是**「恢复了旧链」，而是**同一张表承载新语义 + 旧列留空**。

---

## 13. Parameter Search 合法上游输入（规格 §14，**真实消费验证**）

### 13.1 做法

经既有端点 `paramSearch.createSearch`（`server/paramSearchRouter.ts:1230`）建一次真实搜索。
入口坐标 = `strategyId = "first-board-pullback"` + `strategyVersion = "1.0.0"`。
🔴 `searchMethod` 用枚举成员 **`"GRID_SEARCH"`**（不是 `"grid"`）。

### 13.2 实测结果

```json
{"searchRunId": "PSRUN-20260921-ce70772c",
 "strategyId": "first-board-pullback", "strategyVersion": "1.0.0",
 "datasetVersionId": 390002, "datasetVersionLabel": "v2",
 "startDate": "2025-06-02", "endDate": "2025-08-29",
 "searchMethod": "GRID_SEARCH", "status": "CREATED"}
```

| 判据 | 实测 |
| --- | --- |
| `searchable` **恰好** = 两个 `TUNABLE` 参数 | `maxBreakDepthRatio, maxVolumeRatio` —— 多余 0 个、缺失 0 个 |
| 死参数筛查 | `referenceCheckApplied = true`、`unreferencedTunableCodes = []` |
| 组合数 | **44**（现算网格组合数 44，两侧相等） |
| `parameterSpaceFingerprint` | `46d28563f5ed3f10e57bc90ac59104a2e9f0a6ff76d008fdc237be44234e3eed` |
| 固定坐标 | `{datasetVersionId: 390002, datasetVersionLabel: v2, startDate: 2025-06-02, endDate: 2025-08-29, executionPolicyVersion: 1, strategyVersionId: "first-board-pullback@1.0.0", evaluationConfigFingerprint: 57cb80106405f61a…}` |

### 13.3 边界（如实登记）

- **只建 Search，不跑回测**：`createSearch` 本身**不执行回测**（只落 Run + 组合计划），本轮**遵守**这一点，
  不去偷偷触发执行 —— 因此「合法输入 + 真实消费」的证明是「真实落库 + 组合数一致 + 可搜索面正确」，
  **不是**「搜索出最优参数」。
- **一律不择优**：本轮**没有**读 `parameter_search_result` 挑参数、**没有**排序、**没有**产生
  `recommended` / `best` / `optimal` / `winner` / `top*`（§17）。
- **探针自清**：验证后删除本次搜索的 3 类行 —— `parameterSearchRun: 1` + `parameterSearchCombination: 44` +
  `parameterSearchResult: 0`（**0** 是因为没跑回测）⇒ **0 残留**，不留垃圾在库里。

---

## 14. Backtest 识别（规格 §15，**真实消费验证**）

### 14.1 做法

走既有装配入口 `assembleRunWorkbenchInputs`（`server/runWorkbenchAssembly/assemble.ts:967`），
它内部经 `runWorkbenchStrategyService.loadVersion` → `assembleStrategySide` → `requireRecipe`。
**禁止**：复制 Strategy 到 Backtest、绕过 Strategy Core、直接调旧 `signalEngine`。

### 14.2 实测结果（13.1 秒真实装配）

```json
{"elapsedMs": 13094,
 "datasetSource": "registry",
 "datasetRowCount": 150873,
 "datasetSecretCount": 2967,
 "recipeId": "strategy-declared-conditions",
 "recipeSource": "strategy-declarative-conditions",
 "strategyDecisionEngine": "strategy-core",
 "simulation": {"initialCapital": 1000000, "maxPositions": 5, "executionModel": "NEXT_OPEN",
                "costModel": {"commissionRate": 0.00025, "lotSize": 100, "minCommission": 5,
                              "slippageBps": 5, "stampDutyRate": 0.0005, "transferFeeRate": 1e-05}}}
```

| 判据 | 实测 | 意义 |
| --- | --- | --- |
| 装配成功 | **13094 ms** / **150873 行** / **2967 只证券** | 真实数据面被真正加载 |
| 配方来源 | `strategy-declarative-conditions`（`recipeId = strategy-declared-conditions`） | 走的是**声明式条件编译**，不是默认配方 |
| 决策引擎 | **`strategy-core`** | 🔴 **不是**旧 `signalEngine` ⇒ Strategy Core 真的在决策位上 |
| 数据集来源 | `registry` | 走注册表，不是旁路 |
| 执行 / 成本模型 | `NEXT_OPEN` + 佣金 0.025% / 印花税 0.05% / 过户费 1e-5 / 滑点 5bp / 100 股 / 最低 5 元 | 装配把策略文档里的 `costModel` **读出来了**（说明文档字段真的被消费，不是摆设） |

### 14.3 「`loopRun useRealData → recipeRegistry → signalEngine` legacy path」的处置

规格 §15 要求：若发现该 legacy path，**只有真正阻塞时才修**。

- **事实**：装配结果实测 `strategyDecisionEngine = "strategy-core"` ⇒ 本策略**没有**落到 `signalEngine`。
- **处置**：**未修**。理由 = 规格明确「只有真正阻塞时才修」，而本轮链路**未被阻塞**。
- **登记为技术债（不修也要写清楚）**：`requireRecipe` 有**三条路径**（`document.recipe` → `compileConditionRecipe` → `DEFAULT_STRATEGY_RECIPE_ID`），
  其中第三条是「文档既没声明 recipe、也编译不出条件时**回落到某个默认配方**」。
  本策略走的是第二条（`recipeSource = strategy-declarative-conditions`），**未**触发回落；
  但这条回落路径**存在且静默** —— 若将来某策略的条件全部 `enabled: false`，它会**安静地**换一份规则去回测。
  **本轮不修**（超出 §24 范围），但已登记为 `BD-21`（见 §22.3）。

### 14.4 🔴 本轮修复的真实产品缺陷 #1（§15 阻塞级）

**现象**：修之前，`compileConditionRecipe("first-board-pullback@1.0.0")` **抛领域错误**：

```json
{"ok": false, "name": "StrategyRecipeRuntimeError", "code": "RECIPE_PARAMETER_INVALID",
 "message": "配方参数 `maxBreakDepthRatio` 必须是有限数字，实际 undefined（拒绝静默取默认值）。"}
```

**为什么是结构性缺陷（不是一次性 bug）**：
「声明式条件」这条路对**任何**参数 code ≠ **已注册配方**那三个 code
（`max_volume_ratio` / `max_drawdown` / `require_bullish`）的策略，**都不可用**。
根因在注册期的**门槛引用面探测**：`buildGatesProbe` 把探测参数集**写死**成 `Object.values(PULLBACK_PARAMETER_IDS)`，
而合成配方的参数 code 来自**策略文档**（`maxBreakDepthRatio` / `maxVolumeRatio`）⇒
`buildGates` 拿到 `undefined` ⇒ `requireNumericParameter` 抛。

**修法（最小面，3 处、零签名破坏）**：

| 文件 | 改动 |
| --- | --- |
| `server/research/recipeRegistry.ts` | `gated` 支新增**可选**字段 `gateProbeParameterCodes?: readonly string[]`（不给 ⇒ `[]`）；`buildGatesProbe` 把额外 code 补进探测集 |
| `server/research/conditionSignal/compile.ts` | `compileConditionRecipe` 收集门槛里**实际引用的**参数 code，下传给 `buildGatedRecipeRuntime` |
| `tests/server/research/conditionSignal/compile.test.ts` | 新增 describe「参数 code 不在已注册配方的参数面内（SRB001 §15 回归）」**4 例**（含**夹具自检**：断言这两 code **不在** `PULLBACK_PARAMETER_IDS` 里） |

**可证伪性（已注入式验证）**：把 `for (const name of extraCodes) probe[name] = 0;` 改成 `void name;`
⇒ 新增 4 条中 **3 条变红**，失败栈正是 `buildGatesProbe → requireNumericParameter`；还原后 **32 / 32 绿**。

**为什么 28 例旧单测全绿也没抓到**：原夹具的 `PARAM_SCHEMA` 用了 `max_drawdown` ——
**恰好命中**那份硬编码探测集 ⇒ 缺陷被夹具**意外回避**。这是「**夹具把缺陷掩盖成契约**」的又一个样本。
所以本轮新增的 4 例里，第一条就是**夹具自检**（证明新夹具**没有**再撞上硬编码集）。

### 14.5 🔴 本轮修复的真实产品缺陷 #2（§16 可达性级）

**现象**：前端溯源面板读到过一次**中间态** `panelState = { evidenceBlock: false }` ——
「溯源卡片在、研究证据不在」。

**根因**：`DbStrategyResearchProvenanceRepository` 的三个**读**方法
（`getByStrategyVersionId` / `listByStrategyId` / `getBySourceCandidateId`）**没有继承**全站既有的
`withReadRetry` 兜底约定。而前端溯源 query 是 **`retry: false`**（溯源是「可缺、不阻断」的附加信息，
故意不自动重试）⇒ 服务端**单次**冷启动 / 死连接失败会**原样透到页面**，
用户看到「溯源读取失败」并**看不到研究证据** ⇒ §16「证据必须可见」**落空**。

**修法**：三个读方法包 `withReadRetry`；**写路径**（`create` / `delete*`）**不重试**（重试写会造重复行）。
与 `9cl` / 004 的同类缺陷**同一族**（004 是 `runRepository` 的 5 处读路径）。

**行为回归**：新建 `tests/server/research/strategyCandidate/provenanceReadRetry.test.ts` **6 例**
（读：瞬时失败 → 调用 **2** 次且结果正确；语义错误 `ER_NO_SUCH_TABLE` → 只 **1** 次并原样抛；
写：瞬时失败 → 只 **1** 次；**夹具自检**：连续两次瞬时失败 → **3** 次）。
**可证伪性（已注入式验证）**：临时摘掉 `getByStrategyVersionId` 的 `withReadRetry` ⇒
恰好 **2 条变红**（「调用 2 次」+「夹具自检」），另两条读路径用例仍绿 ⇒ 证明是**各自的** `withReadRetry` 在生效；还原后 **6 / 6 绿**。

---

## 15. 前端可见性（规格 §16）

### 15.1 落点（这条是「接线完成 ≠ 用户够得到」的老坑）

| 项 | 事实 |
| --- | --- |
| 组件 | `client/src/components/research/StrategyResearchProvenancePanel.tsx`（约 205 行） |
| 挂载点 | `client/src/pages/StrategyDetail.tsx:845` |
| 🔴 关键 | 面板住在**「版本与状态」标签页**内，而详情页**默认标签是「策略定义」** ⇒ **不点标签根本看不到** |
| 列表页入口 | `client/src/pages/StrategyList.tsx:96-101`：每张卡片是**整块 `<button>`**（**没有**「打开」文案） |
| 适配层 | `client/src/adapters/strategyCandidateAdapter.ts#researchEvidencesToVm` + `EVIDENCE_KIND_LABELS` |

### 15.2 实测（走**完整真实用户路径**，无头 Edge + Node `WebSocket` 直连 CDP 量 DOM）

路径：`/strategies` → **点策略卡片** → 等标签渲染 → **真实鼠标点「版本与状态」** → 等**证据区块本体**渲染 → 逐项断言。

**结果：36 / 36 PASS × 2 次确定性**

| 断言组 | 内容 |
| --- | --- |
| A | 列表页可达、非白屏（正文 1103 字符）、含本策略 id、侧栏「策略」高亮（分段精确匹配 + 最长命中） |
| B | **从列表点击**真的进了详情路由 `/strategies/first-board-pullback`（不是 URL 直敲）；详情页可达；「版本与状态」标签可见；**真实鼠标点击成功**（rect 535,175,101×29）；溯源卡片已渲染 |
| C | 证据区块标题「**研究证据（5 条 · 只读）**」；指纹徽标 `evi-sha256:f0959a03f21bd16a`（与后端**逐字节**一致）；3 个中文类别标签（**结果摘要 / 稳定性结论 / 样本账**——枚举码**不进 DOM**）；3 个 runId 逐条可见；2 个实验编号可见；5 条 `reference` 路径逐条可见；数据集坐标 `#390002（v2）` 可见；五问字段标签可见；尾注「不构成本策略的买入 / 卖出规则」可见 |

### 15.3 探针自身踩过的 5 个坑（**判据自身写错**，不是产品缺陷）

首跑 **25 FAIL**，逐条定位后**全部**是探针写法问题：

| # | 坑 | 正解 |
| --- | --- | --- |
| 1 | 按「打开」文字找入口 | 卡片是**整块 `<button>`**，改用 `clickByContainsExpr("button", STRATEGY_ID)` |
| 2 | 以为面板在默认标签 | 面板在**「版本与状态」**里，必须**真点标签** |
| 3 | 对 `<button role="tab">` 调 JS `.click()` | **Radix Tabs 只认真实鼠标**：JS 点返回成功但**内容不切换**（**假 PASS 来源**）⇒ 改 CDP `Input.dispatchMouseEvent` 的 `mouseMoved` + `mousePressed` + `mouseReleased` |
| 4 | 点标签时机太早（页面还在「加载版本…」） | 新增 `tabsWait`，先等标签渲染 |
| 5 | 等待条件只等**卡片标题**（同步 prop，立刻为真） | 改为等**证据区块本体**：`研究证据（5 条 · 只读）` |

⚠️ 第 3 条是**最有价值的一条**：它意味着「JS 点击」在 Radix 上会给出**假 PASS**——
判据看起来绿了，实际什么都没验证。这与 `9cl` / `9cj` 登记的「判据自身写错」**同源**，已按项目纪律登记原因。

### 15.4 顺带修掉的一处字符串漂移

E2E 与探针原先各自写死策略名 / 描述字面量 ⇒ 与 `firstBoardPullbackStrategyDraft.ts` 的真源**可能漂移**。
已改为 import `FIRST_BOARD_PULLBACK_STRATEGY_NAME` / `_DESCRIPTION`（**唯一真源**）。

---

## 16. 严禁自动择优（规格 §17）

| 判据 | 结果 |
| --- | --- |
| 页面出现 `recommended` / `best` / `optimal` / `winner` / `top\d` | **0** |
| 页面出现中文择优措辞（最优 / 最佳 / 推荐买 / …） | **0** |
| 扫描方式 | **句子级 + 中英双语**，且**排除否定句**（含 `不` / `禁` / `未` / `无` / `非` / `没有` 的句子不算违规） |
| 扫描规模 | 详情页 **174 句** / 列表页 **97 句**，offenders 均 **0** |
| EXP-002 的 `15 stable / 0 sensitive / 1 insufficient` 的定位 | **只作 provenance**（证据 `customPayload.counts.stableCount` / `customPayload.overallVerdict`），**没有**被解释成「最优策略」 |
| 自动择优动作 | 本轮**没有**挑最佳买入日 / 回撤深度 / 观察窗口 / 参数 / 条件 / 策略 |

⚠️ 为什么 `stableCount = 15` 能被当证据而**不**是择优：证据的 `reference` 指向的是**研究结论字段本身**
（「有多少个变体未观察到超容差变化」），**不是**「哪个参数最好」。`stable` 的定义在 EXP-002 报告里
已被钉死为「**未观察到**超容差变化」≠「已证明稳定」——本轮**沿用**这个定义，**没有**放宽它。

---

## 17. 测试（规格 §18）

### 17.1 规格 §18.1–18.7 逐项

| 规格项 | 覆盖文件 | 例数 | 结果 |
| --- | --- | --- | --- |
| §18.1 Research Evidence 校验 | `tests/server/research/strategyCandidate/researchEvidence.test.ts` | **23** | 全绿 |
| §18.2 Snapshot / Fingerprint（same → same；evidence changed → 变化） | 同上 + `strategyBridgeEvidence.test.ts` | 12 | 全绿 |
| §18.3 StrategyVersion（创建 1.0.0 / 读取 / snapshot / fingerprint / provenance / immutable） | `tests/server/researchExperiments/firstBoardPullbackStrategy.test.ts` | **14** | 全绿 |
| §18.4 PIT | 同上（`observationWindow.end == DECLARED_DECISION_OFFSET_DAYS`） | — | 全绿 |
| §18.5 Parameter Search 合法输入 | `analysis` 侧既有 `parameterSearch` 套件 + E2E 段 6 | 30 + 38 | 全绿 |
| §18.6 Backtest 可进输入链 | E2E 段 7（真实装配） + `legacyFreeProductionChain` | 7 | 全绿 |
| §18.7 Legacy Free | `tests/server/research/legacyFreeProductionChain.test.ts` | **7** | 全绿 |
| （本轮新增回归）§15 缺陷 #1 | `tests/server/research/conditionSignal/compile.test.ts` | **32** | 全绿 |
| （本轮新增回归）§16 缺陷 #2 | `tests/server/research/strategyCandidate/provenanceReadRetry.test.ts` | **6** | 全绿 |

### 17.2 定向回归（本轮实跑）

```
Test Files  28 passed (28)
     Tests  651 passed (651)
```

覆盖：`strategyCandidate` / `conditionSignal` / `recipeRegistryParameters` / `strategyPersistence` /
`parameterSearch` / `researchExperiments`（11 文件）/ `legacyFreeProductionChain` /
`client adapters` / `client pages`。

🔴 **判据是「零新增失败文件」而不是「全绿」**（`9cl` 已登记的纪律）：
把「全绿」当判据会让已知的环境依赖失败长期掩盖真回归。本轮定向集合**未触及**那批环境依赖失败文件，
故此处表现为全绿，**但这不等于**全仓无环境失败。

### 17.3 `tsc --noEmit`

**exit 0 / 0 error**（多轮复跑一致）。

### 17.4 本轮登记「判据自身写错 / 工具自身出错」（按项目纪律，**登记原因**而非只把颜色刷绿）

| # | 条目 | 为什么错 | 后果 |
| --- | --- | --- | --- |
| 1 | 前端探针 5 条（§15.3） | 把「我当时看到的那一种写法」当成契约 | 首跑 25 条**假 FAIL** |
| 2 | 新增测试文件首次运行 **0 test** | 相对路径少一级（`tests/server/research/strategyCandidate/` 比 004 的目录**深一级**，应是 `../../../../` 而非 `../../../`） | 模块解析失败；**已修，6/6 绿** |
| 3 | E2E 首次查 `dataset_version` 报 `Unknown column 'versionlabel'` | 列名是 `version`，不是 `versionLabel` | 已改 `version AS versionLabel` |
| 4 | E2E 未捕获异常只吐裸堆栈（无判据汇总） | 缺 `process.on("unhandledRejection"/"uncaughtException")` 兜底 | 已补，异常也走 `finish(1)` 落盘 |
| 5 | 层 2 行尾粗判据把 **329 个 CRLF** 文件判为「不应为 CRLF」 | 判据写的是「已跟踪文件应为 LF」，而本仓 `client/**` 有一批文件**自 2026-08-30 起**在磁盘上就是 CRLF（mtime 实证）—— 判据**不知道**「基线里本来就是 CRLF」这回事 | 若不纠正会得出「本轮引入 329 处漂移」的**假结论**。已改用**基线 blob ↔ 工作区**比对 + 逐文件字节判定（§23.3） |
| 6 | 项目惯用闸 `scripts/checkEolDrift.mjs` 无法运行 | **环境缺陷**（见 §25.3），不是判据写错 | 已用等价/更严替代判据补齐 |

---

## 18. 真实 E2E（规格 §19）

### 18.1 规模与形态

`docs/evidence/_e2e_srb001_bridge_consumption.mts`（约 560 行）——**43 项判据，0 项失败**，
`phase = "done"`。**8 段**：

| 段 | 内容 |
| --- | --- |
| 0 | 前置：真实 Dataset `390002` + **3 个真实 Run**（逐个查库确认 `COMPLETED` + 绑定 `390002`） |
| 1 | 真实建策略（`createFromEvidenceRuns`） |
| 2 | 幂等（重放 ⇒ `created=false`、id 与指纹不变） |
| 3 | 证据改变 ⇒ 响亮冲突（`*_CONFLICT`）与引用不可解析（`*_UNRESOLVED`，且**不落任何行**） |
| 4 | §16 溯源读回（`getVersionProvenance`） |
| 5 | 三张表**真实落盘行**（`strategies` / `strategy_versions` / `strategy_research_provenance`） |
| 6 | §14 Parameter Search（真实 `createSearch`） |
| 7 | §15 Backtest 装配（真实 `assembleRunWorkbenchInputs`） |
| 8 | 清理（自清 parameter_search 3 类行；**策略行作为交付物保留**） |

**规模**：Dataset `390002`（真实）/ Research（真实 Run）/ Strategy（真实持久化对象）——
**没有任何一段是 mock，也没有只测 TS 类型**（规格 §19 的两条禁令）。

### 18.2 真实落盘的交付物

```json
{"strategies": [{"id": 1110001, "strategyId": "first-board-pullback",
                 "name": "首板回踩（不破首板日开盘价 + 缩量）",
                 "latestVersion": "1.0.0", "status": "Draft", "currentVersionId": 1110001}],
 "strategyVersions": [{"id": 1110001, "version": "1.0.0",
                 "fingerprint": "819c1c50903498e7ca167a2e6a1ba6a32bc57e1cb5730f07101bc7f6ae30c389",
                 "datasetVersion": "v2", "datasetVersionId": 390002, "status": "Draft"}],
 "provenance": [{"id": 630001, "strategyVersionId": 1110001,
                 "sourceKind": "INDEPENDENT_EXPERIMENT",
                 "experimentRef": "first-board-pullback/fundamental-study",
                 "experimentVersion": "1.1.0",
                 "experimentResultDigest": "exp-sha256:63e77251a95bd41d",
                 "sourceDatasetVersionId": 390002, "origin": "DIRECT"}]}
```

⚠️ 记录到的这次运行走的是**幂等分支**（`created = false`）—— 策略行由**本轮首次运行**创建后**刻意保留**，
复跑自然命中幂等路径。**幂等本身就是 §6 / §18.3 的判据**，所以这不是「没建成」，而是「建成了且重放不重复建」。

### 18.3 清理与保留（在途 Run 安全）

| 项 | 处理 |
| --- | --- |
| `parameter_search_run` / `_combination` / `_result` | **自清**（`deleted: {run: 1, combination: 44, result: 0}`）⇒ 0 残留 |
| 策略三张表的行 | **保留**（`strategy_versions.id = 1110001`、`provenance.id = 630001`）—— 它们是本任务的**交付物**，且 §16 前端可见性验收**需要**它们存在 |
| 在途 Run 前置闸 | 动手前跑 `_probe_inflight_runs.mts`：**活跃表全 0 个 `RUNNING`**，唯一命中 `archive_research_question:270001`（2026-09-17 归档表僵死）⇒ 判定可安全改 `server/**` |

### 18.4 最小 Backtest 的成本说明（规格 §19 允许，但须如实说）

规格允许「最小 Backtest 若成本不宜跑则只做真实入口验证并如实说明」。本轮**选择**：
**只做真实装配入口验证**（13094 ms / 150873 行 / 2967 只证券，§14.2），**未取行情快照、未进撮合**。

**理由（不是省事）**：完整回测需要额外的行情快照与撮合，而**本轮没有任何一条判据依赖回测结果** ——
§15 要的是「能被 Backtest 识别（最小真实消费验证）」，装配成功 + 决策源是 Strategy Core + 配方来源正确
**已经**证明这件事。**未跑的部分如实标注**，不含糊成「已跑通回测」。

⚠️ 若把「未跑完整回测」写成「已验证回测可用」，那就是把**入口验证**冒名成**结果验证** —— 本轮没有这样做。

---

## 19. 数据库与 migration（规格 §20）

| 项 | 结果 |
| --- | --- |
| 新增表 | **0** |
| 新增列 | **0** |
| 新增 migration | **0**（`drizzle/**` 零改动；migration 已用至 `0047`，**未增** `0048`） |
| 承载方式 | 复用既有 `strategy_research_provenance`（JSON 列 `sourceSnapshotJson` 承载证据快照 + `experimentParametersJson` 承载参数）—— **JSON / snapshot 能承载就不建表** |
| 证据指纹存放 | 进 `sourceSnapshotJson` 的固定键 `researchEvidenceFingerprint`（**零 DDL**） |

---

## 20. 范围控制（规格 §24）

**明确未做**（逐条如实登记）：

- ❌ 未做 EXP-003；
- ❌ 未新增 Research Experiment（两个实验目录本轮**零改动**）；
- ❌ 未新增 Robustness Engine；
- ❌ 未新增 Parameter Search 算法；
- ❌ 未新增 Backtest Engine；
- ❌ 未做 OOS / Walk-Forward / Paper Trading / Production；
- ❌ 未跑完整回测（只做装配入口验证，§18.4）；
- ❌ 未清理生产库既有孤儿数据（`9ck` 登记的 9 行，属独立数据运维任务）；
- ❌ 未修 `requireRecipe` 的「无 recipe 时回落默认配方」静默路径（登记为 `BD-21`，超范围）。

---

## 21. 交付物清单

### 21.1 生产代码

| 文件 | 性质 | 说明 |
| --- | --- | --- |
| `server/research/strategyCandidate/researchEvidence.ts` | **新增**（约 470 行） | Research Evidence 契约 + 指纹 + 快照 + 解析 |
| `server/researchExperiments/evidenceRunReader.ts` | **新增**（115 行） | 经既有 Run 仓储读结果信封（**不碰 MinIO SDK**） |
| `server/researchExperiments/firstBoardPullbackStrategyDraft.ts` | **新增**（约 470 行） | 首条真实策略草稿 + 5 条证据 + 参数空间 + **18 条决策登记** |
| `server/researchExperiments/strategyBridge.ts` | **扩展**（约 880 行） | 新增 `createStrategyFromEvidenceRuns`（保留原 `createStrategyFromExperiment`） |
| `server/researchExperiments/strategyBridgeRouter.ts` | **新增**（245 行） | `createFromEvidenceRuns` 端点 |
| `client/src/adapters/strategyCandidateAdapter.ts` | **扩展**（约 940 行） | `researchEvidencesToVm` + `EVIDENCE_KIND_LABELS` |
| `client/src/components/research/StrategyResearchProvenancePanel.tsx` | **新增**（约 205 行） | 研究证据区块 |
| `server/research/recipeRegistry.ts` | **修缺陷 #1** | `gateProbeParameterCodes?` + `buildGatesProbe` 补探测 code |
| `server/research/conditionSignal/compile.ts` | **修缺陷 #1** | 下传实际引用的参数 code |
| `server/research/strategyCandidate/provenance.ts` | **修缺陷 #2** | 3 个**读**方法包 `withReadRetry`（写不重试） |

### 21.2 测试

`tests/server/research/strategyCandidate/researchEvidence.test.ts`（23）、
`tests/server/researchExperiments/firstBoardPullbackStrategy.test.ts`（14）、
`tests/server/researchExperiments/strategyBridgeEvidence.test.ts`（12）、
`tests/server/research/conditionSignal/compile.test.ts`（+4 ⇒ 32）、
`tests/server/research/strategyCandidate/provenanceReadRetry.test.ts`（6，**新增**）

### 21.3 证据（`docs/evidence/`，该目录整体 gitignore）

| 文件 | 结果 |
| --- | --- |
| `_e2e_srb001_bridge_consumption.mts` + `.out.json` / `.out.txt` | **43 / 43 PASS** |
| `_probe_srb001_doc_params.mts` + `.out.json` | 缺陷 #1 的**只读根因证据** |
| `_probe_srb001_strategy_detail_frontend.mjs` + `.out.json` / `.out.txt` | **36 / 36 PASS × 2** |
| `_probe_srb001_baseline.mts`、`_probe_srb001_result_paths.mts` | 前置现状确认 |
| `_probe_srb001_git_and_eol_state.py` + `.out.json` | git 元数据完整性 + 行尾状态（**只读**；见 §25.3） |

### 21.4 台账

`ROADMAP.md`（§44 上轮实查覆盖式 + §44.5 队列 + 编号台账）、`ROADMAP-CHANGELOG.md`（append + 归档被覆盖条）、
`docs/architecture/CHANGE-AUDIT.md`、`docs/evidence/README.md`。

---

## 22. 台账与下一阶段（规格 §22）

### 22.1 编号台账

| 项 | 值 |
| --- | --- |
| 取号时实查 | `ROADMAP.md:2121` 原写「已用至 `9cl`」 |
| 本轮编号 | **`9cm`**（**禁「末条 +1」**；按「下一个未占用」取） |
| 更新后 | 「已用至 **`9cm`**」⇒ 下一个未占用 = **`9cn`** |
| 同步位置 | `ROADMAP.md` **两处**（文件头铁律行 + §44.5 编号台账行） |

### 22.2 文档自洽性修正

`ROADMAP.md:4`（铁律行）与 `:2121`（台账行）**同时**更新（单一处改会留下互相矛盾的台账）。

### 22.3 新增技术债登记

| ID | 内容 | 建议 |
| --- | --- | --- |
| `BD-21` | `requireRecipe` 的第三条路径（`document.recipe` 缺失且条件无法编译时**静默回落** `DEFAULT_STRATEGY_RECIPE_ID`）—— 本策略未触发，但路径存在 | 是否要求「回落时必须留痕（日志 + 溯源字段）」 |
| `BD-22` | 本仓 git 仓库**元数据受损**（§25.3），项目惯用的两道 git 闸（`git status --porcelain` 前置 + `checkEolDrift.mjs`）**当前不可运行** | 需人工裁定修复路径（§25.4） |
| `BD-23` | `client/**` 有 **329** 个文件在磁盘上为 CRLF（`i/lf w/crlf`），mtime 追溯至 **2026-08-30** ⇒ 长期状态 | 是否统一归一化为 LF（**须显式指令**，见 §23.3） |

### 22.4 下一阶段（**明确指向 PARAMETER SEARCH**）

本轮已把 `first-board-pullback v1.0.0` 做成 Parameter Search 的**合法上游输入**（§13 真实消费验证：
`searchable` 恰为 2 个 `TUNABLE`、组合数 44、`referenceCheckApplied = true`）。

⇒ **下一阶段 = PARAMETER SEARCH**：在这个已经真实闭合的坐标
（`first-board-pullback@1.0.0` × `Dataset 390002`）上**执行**搜索并评估参数有效性。
⚠️ 前置提醒（`9cc` 已登记）：本轮**只建 Search、未跑回测**；下一阶段一开跑就要面对
「参数消费链通 ≠ 有证据」的老问题 —— 因此**必须先跑 `_probe_9cc_strategy_params.mts`** 确认规则图引用面非空。

---

## 23. 完成判据自评（规格 §23）

### 23.1 判据表（自变量 = 本任务交付物）

| Gate | 判据 | 结果 | 证据 |
| --- | --- | --- | --- |
| A | 链路可追溯（Strategy → Evidence → Run → Dataset） | ✅ | E2E 段 4 读回 + 前端 C 段 |
| B | 证据引用真实 Run / ExperimentVersion | ✅ | E2E 段 0/1（3 Run 逐条查库） |
| C | 不存在的引用被响亮拒绝且不落行 | ✅ | E2E 段 3（`UNRESOLVED`，`strategies` 行数 0） |
| D | 证据进可追溯身份（独立指纹） | ✅ | `evi-sha256:f0959a03f21bd16a`，前端 C2 逐字节比对 |
| E | 同证据 ⇒ 同指纹（幂等） | ✅ | E2E 段 2（`created=false`，id 与指纹不变） |
| F | 证据改变 ⇒ 可识别变化 | ✅ | E2E 段 3（`*_CONFLICT`，`1 → 1`） |
| G | 研究事实与交易规则分离 | ✅ | §3 + §8（16/18 明标设计决策） |
| H | PIT / `decisionOffsetDays` / `rd<=5` 一致 | ✅ | §11（三层证据） |
| I | 严禁自动择优 | ✅ | §16（174 + 97 句，offenders 0） |
| J | StrategyVersion 是 Parameter Search 合法输入 | ✅ | §13（真实 `createSearch`，44 组合） |
| K | Strategy 能被 Backtest 识别 | ✅ | §14（13094 ms 真实装配，决策源 `strategy-core`） |
| L | 前端至少可见 Research Evidence 区块 | ✅ | §15（36/36 × 2，走完整用户路径） |
| M | 测试与 Legacy Free | ✅ | §17（定向 28 文件 / 651 例，legacy Gate 7/7） |
| N | 零新表 / 零 migration / 范围控制 | ✅ | §19 / §20 |

**24 项判据全部满足**（上表 14 行 + 各节内嵌的 10 项细分判据）。

### 23.2 判据**自身**的可证伪性（本项目硬纪律）

| 判据 | 注入式验证 | 结果 |
| --- | --- | --- |
| §15 缺陷 #1 的回归 4 例 | 把 `probe[name] = 0` 改成 `void name` | **3 条变红**，失败栈 = `buildGatesProbe → requireNumericParameter` |
| §16 缺陷 #2 的回归 6 例 | 摘掉一个读方法的 `withReadRetry` | **恰好 2 条变红**，另两条仍绿 ⇒ 证明各自生效 |
| git 完整性判据 | 判据读的是**文件系统 + git 对象库**，不读「报告怎么写」 | 见 §25.3 |

### 23.3 行尾判据（**替代判据**，见 §25.3）

原判据 `scripts/checkEolDrift.mjs` **无法运行**（环境缺陷）。替代判据两层：

| 层 | 判据 | 结果 |
| --- | --- | --- |
| 1 | 基线 blob（对象库中**仍然存活的最新 commit** `07fcbf494032`）↔ 工作区的**双 diff**（普通 vs `--ignore-cr-at-eol`，同 `checkEolDrift` 的算法） | **疑似行尾漂移 = 0**（参与比较 457 个文件） |
| 2 | 本轮 **15 个**新建 / 修改文件**逐个原始字节**分类（要求纯 LF） | **15 / 15 = LF**（`taskFilesAllLf = true`） |
| 补充 | `git ls-files --eol` 全仓 1839 文件的 index/worktree 形态分布 | `i/lf w/lf` **1243**；`i/lf w/crlf` **329**（**均为 2026-08-30 起的长期状态，非本轮文件**）；`i/crlf w/crlf` **2**（= 约定的 `App.tsx` / `AppShell.tsx`） |

🔴 **两层判据比原脚本更严**：`checkEolDrift.mjs` 用的是启发式（改动量 ≥ 20 行 **且** 占比过半），
对小文件的漂移**可能漏判**；层 2 是**逐文件字节判定**，不存在阈值。

⚠️ **层 2 的第一次写法是错的**（§17.4 第 5 条）：最初写「已跟踪文件应为 LF」，结果报出 **333** 个「不应为 CRLF」
—— 其中包含自 **2026-08-30** 起就在磁盘上是 CRLF 的文件（mtime 实证）。**判据修正为「基线 blob ↔ 工作区」**
之后结论才成立 —— 否则会得出「本轮引入 329 处漂移」的**假结论**。这条**按项目纪律登记了「为什么错」**。

---

## 24. 规格 §25：最终状态与未完成项

### 24.1 状态判定

**`STRATEGY-RESEARCH-BRIDGE-001 = COMPLETE`**

理由：规格 §23 的全部判据满足（§23.1）；§24 范围控制全部守住（§20）；
两条真实产品缺陷已修并加**可证伪**回归（§14.4 / §14.5）。

### 24.2 明确「部分满足 / 降级」的项（不含糊）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 最小 Backtest | **入口验证 ✅ / 完整回测 ❌（刻意）** | §18.4；本轮无判据依赖回测结果 |
| 无 look-ahead | **推导 + 研究侧引用 + 结构级 ✅ / 数值实证 ❌** | §11.3 |
| 行尾闸 | **替代判据 ✅ / 原闸 ⛔ 环境缺陷** | §23.3 / §25.3 |
| `git status --porcelain` 前置 | ⛔ **无法运行** | §25.3 |

### 24.3 🔴 环境缺陷（**不是本任务引入，但阻塞了一道项目惯用闸**）

**现象**：项目根目录下**任何** `git` 命令都返回

```
fatal: not a git repository (or any of the parent directories): .git
```

**根因（git 自身判据，非猜测）**：git 的 `is_git_directory()` 要求 `$GIT_DIR` 下同时存在
`HEAD`、`objects/`、**`refs/`** —— 本仓

| 项 | 状态 |
| --- | --- |
| `.git/refs` | 🔴 **不存在** |
| `.git/packed-refs` | 🔴 **不存在** |
| `.git/objects` | ✅ 存在（1 个 pack 13,342,386 B + 7 个松散对象） |
| `.git/index` | ✅ 存在（206,050 B） |
| `.git/logs/**` | ✅ 存在（reflog 完整） |
| `.git/HEAD` | ✅ `ref: refs/heads/main`（**21 字节，纯 LF，内容正确**） |

**对照实验（排除 git 二进制问题）**：在 `_scratch` 下新建临时仓库，同一 git 二进制
`git init` + `rev-parse --show-toplevel` **正常** ⇒ 问题在本仓 `.git` 的**内容**，不在 git。

**受损面（对象库盘点实测）**：

| 项 | 实测 |
| --- | --- |
| 对象库剩余对象总数 | **5792**（blob 3780 / tree 1777 / commit **235**） |
| 仍然存活的**最新** commit | `07fcbf494032efe7693b0c99153df129405fc04b`（**2026-09-19 22:56:03**，"Untrack .workbuddy directory again"） |
| 最早存活 commit | `2026-01-05 12:34:45` |
| reflog 记录的 `main` 尖端 | `a871b03345ab6e69ccb27f8108b07f9788d4cbe8`（2026-09-21 02:21）⇒ 🔴 **已不可解析** |
| reflog 记录的 `origin/main` | 同 `a871b033…`（2026-09-21 02:23 "update by push"）⇒ 🔴 **已不可解析** |
| `ORIG_HEAD` 指向（2026-09-20 23:24） | `eafd2ccb4f01f39dc27c94aa0ab8894d99bc9664` ⇒ 🔴 **已不可解析** |
| `.git/index` 引用的唯一 blob | **1830** 个，其中 **241 个缺失** |
| 🔴 关键判据 | 这 **241** 个「缺失 blob」对应的路径**在工作区全部还在**（`stillInWorktree = 241`、`absentFromWorktree = 0`） |

⇒ **丢的是 git 元数据对象，工作区文件零丢失。**

**时间线（mtime 实证）**：

| 时刻 | 对象 |
| --- | --- |
| 2026-09-20 20:50 | pack 文件（最后一次 repack） |
| 2026-09-21 02:21 / 02:23 | 最后一次本地 commit / push（内容已被 reflog 记录） |
| **2026-09-21 15:01:07** | `.git/index` 被改写 |
| **2026-09-21 15:02:58** | `.git/objects` 与 `.git/worktrees` 被改写 |

本轮第一次尝试 `git` 就已失败（早于本任务的行尾闸运行），**该事件与本任务的代码改动无关**
（本任务改动面 = `server/**` 3 文件 + `client/**` 2 文件 + `tests/**` 1 文件 + 文档，**零 `.git/**` 写入**）。

**只读取证手段（零改动真实 `.git`）**：在 `_scratch` 下建**影子 GIT_DIR**
（补齐空缺的 `refs/` + `objects/` 目录，`HEAD` 设为存活基线，`GIT_OBJECT_DIRECTORY` 指向真实 objects，
`index` 从真实 `.git` **复制**一份），从而在本机 git 拒识仓库的情况下仍能取得
`ls-files` / `ls-files --eol` / `cat-file --batch-all-objects` 等**只读**结论。
⚠️ 影子目录是**权宜手段**，**不是修复**，也不构成修复。

### 24.4 建议的修复路径（**需用户显式裁定，本轮未执行**）

按风险从低到高：

1. **备份**：先复制整个 `.git`（`robocopy` 到 `_scratch` 或别处）—— **任何后续动作之前**。
2. **补目录**（纯新增、零删除）：建 `.git/refs`、`.git/refs/heads`、`.git/refs/tags` ⇒
   此时 `git` 会**重新识别**该仓库（`HEAD` 指向不存在的 `refs/heads/main`，属「未出生分支」）。
3. **从远端拉回尖端**：`git fetch origin` ⇒ 恢复 `refs/remotes/origin/main`
   （2026-09-21 02:23 的 push 表明 `a871b033…` **很可能在 GitHub 上仍在**）。
4. **只动索引、不动工作区**：`git reset`（**mixed**，默认）或 `git read-tree HEAD` 重建索引
   （现索引有 241 个悬空 blob 引用，会让 `git status` / `git diff` 以 `fatal: unable to read <sha>` 中止）。
   🚫 **禁止** `git reset --hard` / `git checkout -f` / `git clean` ——
   工作区是本任务与在途会话的**唯一真身**，一旦被覆盖不可恢复。
5. **CRLF 归一化**（可选、**独立**决策）：329 个 `i/lf w/crlf` 文件是否统一转 LF（`BD-23`）。

**在本轮内我未执行上述任何一步**：它们都落在 `.git` 内部，属**需要显式确认**的操作，
且修复与否**不影响**本任务的功能交付（`§23` 的行尾判据已用等价/更严的替代判据补齐）。

---

## 25. 结论

1. **链路真实闭合**：`Dataset Version 390002` → `EXP-001 / EXP-002 真实 Run` → `first-board-pullback v1.0.0`
   的溯源链在**真实库 + 真实对象存储 + 真实 tRPC 端点**上跑通（E2E **43 / 43 PASS**），并在**真实用户路径**上可见
   （前端探针 **36 / 36 PASS × 2**）。
2. **可追溯身份成立**：证据有**独立指纹** `evi-sha256:f0959a03f21bd16a`；同证据 ⇒ 同指纹；证据变 ⇒ 响亮冲突且不落行。
3. **研究事实与交易规则正交**：18 条决策登记里 **16 条**明标「**设计决策，不来自 EXP-001/EXP-002**」；
   **没有任何研究结论被自动翻译成交易规则**。
4. **下游消费真实**：Parameter Search（`searchable` 恰 2 个 TUNABLE、组合 44、真实落库）与 Backtest
   （真实装配 13094 ms、决策源 `strategy-core`）两处都做了**真实消费验证**，不是只看类型。
5. **两条真实产品缺陷已修 + 已钉可证伪回归**：声明式条件配方的**门槛探测参数面**（结构性不可用）、
   溯源仓储**读路径缺 `withReadRetry`**（会让研究证据整块消失）。
6. **零新表 / 零 migration / 零新依赖**；范围严格守住 §24。
7. **两个必须让用户知道的事实**：
   - ⛔ **本仓 git 元数据受损**（`.git/refs` + `packed-refs` 缺失、241 个 index 引用 blob 缺失、
     Sep-20/21 的 commit 不可解析）—— **工作区文件零丢失**，但项目惯用的两道 git 闸当前跑不了。
     **修复需显式裁定**（§24.4）。
   - ⚠️ `client/**` 有 **329** 个文件自 **2026-08-30** 起在磁盘上为 CRLF（长期状态，**非本轮引入**）——
     是否归一化为独立决策（`BD-23`）。
8. **下一阶段 = PARAMETER SEARCH**（§22.4）。

---

*报告生成于 2026-09-21 · 编号 `9cm` · 所有数字均由落盘证据现算（`docs/evidence/_e2e_srb001_bridge_consumption.out.json`、
`_probe_srb001_strategy_detail_frontend.out.json`、`_probe_srb001_doc_params.out.json`、
`_probe_srb001_git_and_eol_state.out.json`），**不读「报告里怎么写」**。*

## 26. Final Closeout（`BD-21` 修复 + Parameter Search 实际研究运行）

> 本节 = `STRATEGY-RESEARCH-BRIDGE-001` 的**唯一**收尾报告（用户规格 §十一 的 6 节结构）。
> 它**不是**新审计：`BD-21` 只处理「真正阻塞的问题」，完成后**直接进入** Parameter Search 实际运行。
> 🔴 本节所有数字均**从落盘证据现算**（`docs/evidence/_probe_bd21_recipe_fallback_real_db.out.json`、
> `_probe_ps001_first_round.out.json`、`_probe_ps001_expanded.out.json`），由脚本
> `C:/work/sourcecode/_scratch/srb001_closeout_report.py` 生成并带**注入式自检**；小数一律 4 位（Python half-even）。

### 26.1 `BD-21` —— `requireRecipe` 静默回落必须留痕

**原问题**：`requireRecipe` 路径 3（文档既无 `recipe`、也无 `definition.entry.conditions`）会落到
`DEFAULT_STRATEGY_RECIPE_ID`（=「按涨跌幅取前 5 名」），但**来源值被标成 `explicit-request`**
—— 与「调用方显式指定 recipeId」**共用同一个值**。要害不是「有兜底」，而是**静默换规则**：
产物看起来完全正常，跑的规则却与策略文档无关；参数搜索会把结果记在一个
**根本没被执行**的策略定义名下。

**实际处理**（最小兼容修改；**零新表 / 零 migration / 零新依赖**）：

1. `RecipeResolutionSource` 增加第 4 值 `"default-fallback"`；路径 3 的**默认常量分支**改用它，
   `explicit-request` **只**留给「调用方显式传值」；
2. 回落点**响亮留痕**：`console.warn`（含策略身份 + 落到的配方 id）—— 刻意放在**唯一判定点**
   （`requireRecipe` 本身），因为 `assembleStrategySide` 被主入口与 `strategyEvaluation` 两条路径
   共用，放调用方**必漏**其中一条；
3. 契约与规范同步：`shared/researchContracts.ts` 的 zod 闭集（不同步 ⇒ 生产上 tRPC `.output()` **拒值**）、
   `assemble.ts` 三处注释、`recipeRegistry.ts` 台账注释、`docs/research/STEP-A-DECLARATIVE-CONDITIONS-implementation.md`
   的三路径表；
4. 前端 `ClosedLoopRunResultPanel.tsx`：兜底时显示**「兜底默认 · 文档未声明配方与条件」**（琥珀色），
   不再只印一个英文枚举 —— 「静默」的用户可见面就在这里。

**验证结果**：

| 判据 | 结果 |
| --- | --- |
| 单元测试 `tests/server/runWorkbenchAssembly/recipeFallback.test.ts` | **4 / 4 PASS**（A 兜底 ⇒ `default-fallback` + 恰一条日志；B 显式 ⇒ `explicit-request` + **零**日志；C 判别力；D zod 闭集四值哨兵） |
| **注入式可证伪**：把兜底改回 `explicit-request` | **恰好 2 条变红**（A / C），B / D 仍绿 ⇒ 判据真的能红；文件按原始字节还原（55257 B / 纯 LF） |
| **真库体检**（`_probe_bd21_recipe_fallback_real_db.mts`，**只读**） | **5 / 5 PASS**；全库 **12** 个策略 / **13** 个版本 ⇒ `strategy-document` **9** / `strategy-declarative-conditions` **2** / `explicit-request` **0** / **`default-fallback` 2** |

🔴 **真库体检给出的关键数字**：修复后 `explicit-request` 计数 = **0**，而
`default-fallback` = **2**（`limit-up-baseline@1.1.0`、`limit-up-baseline@1.0.0`）。也就是说：**修复前，库里 100% 的
`explicit-request` 都是假的** —— 它们全部是「文档没声明任何可执行内容、装配层自己顶上默认配方」，
却被记成「调用方明确要求」。这不是假想分支：这 2 份文档**现在仍走该路径**。

### 26.2 Research → Candidate → Strategy 的真实闭环状态

链路**成立且可追溯**（`9cm` 已建，本轮复核未变）：

```text
Dataset Version 390002（first_limit_pullback v2 / READY / 窗口 2024-09-01 ~ 2026-09-01）
   ├─ EXP-001 first-board-pullback/fundamental-study   Run RUN-20260921-8557F38A
   └─ EXP-002 first-board-pullback/stability-validation Run RUN-20260921-C95B1D47
              ↓ Research Evidence（5 条，逐条指向真实 Run 的真实字段）
   first-board-pullback Strategy Version 1.0.0
     strategy_versions.id = 1110001 · strategy_research_provenance.id = 630001
     sourceKind = INDEPENDENT_EXPERIMENT · 证据指纹 evi-sha256:f0959a03f21bd16a
              ↓
   Parameter Search / Backtest（本轮已**真实运行**，见 26.3）
```

⚠️ 按用户规格，本轮**不**恢复旧 `Analysis → Finding → Conclusion → Candidate` 链
（`sourceCandidateId` / `sourceConclusionId` 仍为 **NULL**），也**未**新建第二套研究系统。

### 26.3 Strategy → Parameter Search 的真实连接状态

本轮**不是审计，是真实运行**。第一轮按规格 §七「先小规模验证完整闭环」执行，
成功后按同条「再扩大搜索规模」扩到 9 组合。

环境（两轮完全相同）：`searchMethod = GRID_SEARCH`；`strategyId/Version = first-board-pullback@1.0.0`；
`datasetVersionId = 390002`；两个 TUNABLE 参数 `maxBreakDepthRatio` × `maxVolumeRatio`。

| 轮次 | Search Run | 组合数 | 真评估 | 缓存复用 | 失败 | 窗口 | 耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 第一轮（smoke） | `PSRUN-20260921-45da2fb2` | 4 | 4 | 4 | 0 | 2025-01-02 ~ 2025-03-31 | 9560 ms |
| 第二轮（expand） | `PSRUN-20260921-b43a5716` | 9 | 9 | 0 | 0 | 2025-01-02 ~ 2025-06-30 | 105241 ms |

判据：第一轮 **11 / 11 PASS**；第二轮 **11 / 11 PASS**（`allPassed = true / true`）。

🔴 **§三.B 的链路判据逐条落实**（这两个 Search Run 的回执本身就是证据）：

- **Strategy Version 可读取**：`first-board-pullback@1.0.0`，
  `name = 「首板回踩（不破首板日开盘价 + 缩量）」`；
- **Dataset Version 坐标明确**：`createSearch` 回执 `datasetVersionId = 390002`
  （label `v2`）；且**不依赖调用方传值**也能派生 —— `resolvePrimaryDatasetVersionId(document) = 390002`（探针步骤 `0b`）；
- **tunable parameters 可被识别**：`searchable = [maxBreakDepthRatio, maxVolumeRatio]`，
  `fixed = 0` / `derived = 0` / `excluded = 0`；
- **搜索空间可获取**：`referenceCheckApplied = true`
  （死参数筛查生效）、`unreferencedTunableCodes = []`（声明为 TUNABLE 的参数**都在** Core 规则图里有引用面）、
  `parameterSpaceFingerprint = a0f6548a00db8eeb…`；
- **既有契约未被绕过**：全程走 `appRouter.createCaller` 的**真实 tRPC 端点**（zod 入参 + `.output()` 校验均参与），
  组合计划与结果均**真实落库**（`parameter_search_run` / `_combination` / `_result`）。

### 26.4 第一轮真实运行结果（规格 §八 的 11 个问题，逐条回答）

**参数空间与执行**（第二轮 expand，窗口 2025-01-02 ~ 2025-06-30）：

1. **搜索了哪些参数**：`maxBreakDepthRatio`（3 值 = ['0', '0.05', '0.1']）×
   `maxVolumeRatio`（3 值 = ['0.5', '1', '1.5']）。
   网格取值**不是发明的**：`0 / 0.05 / 0.1` 对齐 EXP-001 的 `drawdownBucketEdgesBps`
   （`[0, -200, -500, -800, -1000]` bps）的桶边界；`0.5 / 1 / 1.5` 是草稿已声明的缩量粗档。
2. **实际生成多少组合**：**9**（去重后参数组合数与之一致 ⇒ 确为笛卡尔积）。
3. **每个组合是否真的执行**：是 —— `evaluated = 9`、`reusedFromCache = 0`
   （本轮**零缓存命中** ⇒ 9 个组合全部**真算**）、`skipped = 0`。
4. **每个组合使用的参数值**：见下表（9 行）。
5. **使用的 Dataset Version**：`390002`（`dataset_version.version = v2`）。
6. **使用的 Strategy Version**：`first-board-pullback@1.0.0`。
7. **每个组合产生的核心指标**：

| `maxVolumeRatio` | `maxBreakDepthRatio` | 交易数 | 总收益% | 最大回撤% | 胜率% | 盈亏比 |
| --- | --- | --- | --- | --- | --- | --- |
| `0.5` | `0` | 12 | -5.7606 | 5.8560 | 50.0000 | 0.5294 |
| `0.5` | `0.05` | 12 | -5.7606 | 5.8560 | 50.0000 | 0.5294 |
| `0.5` | `0.1` | 12 | -6.5380 | 6.6282 | 50.0000 | 0.4809 |
| `1` | `0` | 39 | -9.9175 | 18.4863 | 58.9744 | 0.6892 |
| `1` | `0.05` | 41 | -13.0017 | 18.5375 | 53.6585 | 0.6407 |
| `1` | `0.1` | 41 | -13.0017 | 18.5375 | 53.6585 | 0.6407 |
| `1.5` | `0` | 81 | -35.0735 | 39.1312 | 34.5679 | 0.3982 |
| `1.5` | `0.05` | 90 | -39.5200 | 43.5977 | 30.0000 | 0.3779 |
| `1.5` | `0.1` | 90 | -39.5200 | 43.5977 | 30.0000 | 0.3779 |

8. **是否存在失败组合**：**否** —— `failedCount = 0`，9 / 9 `SUCCEEDED`。
9. **失败原因**：不适用（无失败）。
10. **是否存在明显的参数敏感性**：**是，两个参数都敏感**（但强度差一个量级）：

    - `maxVolumeRatio` 敏感指标 = 5 / 5 → `maxDrawdownPct, profitFactor, totalReturnPct, tradeCount, winRatePct`；
      三个 `maxBreakDepthRatio` 固定组里**都**观察到变化 ⇒ 单调方向明显：
      放宽缩量门槛（`0.5` → `1.5`）时交易数
      12 → 90，
      总收益 -39.5200% ~ -5.7606%，最大回撤 5.8560% → 43.5977%，
      胜率 50% → 30%，盈亏比 0.5294 → 0.3779 ⇒ **放得越松、亏得越多、回撤越大**（一致方向）。
    - `maxBreakDepthRatio` 敏感指标 = 5 / 5 → `maxDrawdownPct, profitFactor, totalReturnPct, tradeCount, winRatePct`；
      但在 `maxVolumeRatio = 0.5` 这一固定组内，3 个取值的**交易数完全相同（12）**，
      只在 `maxVolumeRatio = 1 / 1.5` 才显出差异（39 → 41、81 → 90）⇒ **它的效应远弱于缩量门槛**，
      且**被缩量门槛的松紧所掩盖**。
    - ⚠️ **负向结论也有证据**：`maxBreakDepthRatio` 在部分格子里「无变化」**可信**，因为
      `notVacuous = true`（该参数确有 3 个不同取值、
      且确有 3 个含 ≥2 取值的配对比较组）⇒ 排除了「比较机制空转」。
11. **是否产生值得进入下一阶段验证的候选参数**（**纯研究结果描述，非系统评级**）：
    在本次两轮共 **4 + 9** 个组合里，**全部组合的总收益均为负**
    （第二轮 0 / 9 个正收益），
    区间 `-39.5200%` ~ `-5.7606%`。**观察到**：
    损失最小的组合**一律**出现在 `maxVolumeRatio = 0.5`（最小门槛）那一列，且该列对
    `maxBreakDepthRatio` **不敏感**（交易数恒 12）。
    🔴 但这一列的交易数只有 **12 笔**（半年窗口）⇒ 统计上极薄，且这只是**单一窗口、单一成本口径**下的事实。
    **是否值得进入下一阶段验证，由人判断**；本轮不产出任何 `recommended` / `best` / `optimal` 结论。

🔴 **同时观察到的一条正向机制证据（非结论）**：门槛越松 ⇒ 交易数与回撤**单调**上升
（交易数 12 → 90；最大回撤 5.8560% → 43.5977%），
说明「缩量」这条筛选**确实在剔除样本**（不是形同虚设）。

### 26.5 Tests / Runtime Verification

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm exec tsc --noEmit` | **exit 0（0 error）** |
| 变更相关测试 | `pnpm run test:changed` | **2 失败文件 / 5 例**，全部落在基线 7 文件之内（`tests/server/limitUp.test.ts` + `tests/server/limitUp.watch.test.ts`，环境依赖）⇒ **零新增失败文件** |
| 新增单元测试 | `vitest run tests/server/runWorkbenchAssembly/recipeFallback.test.ts` | **4 / 4 PASS** |
| 注入式可证伪 | 兜底改回 `explicit-request` | **恰好 2 条变红** ⇒ 判据可证伪 |
| 真库体检（只读） | `tsx docs/evidence/_probe_bd21_recipe_fallback_real_db.mts` | **5 / 5 PASS** |
| Parameter Search 第一轮 | `PS001_SCALE=smoke tsx docs/evidence/_probe_ps001_first_round.mts` | **11 / 11 PASS**（真跑 4 组合） |
| Parameter Search 第二轮 | `PS001_SCALE=expand …` | **11 / 11 PASS**（真跑 9 组合 / 105 s） |

### 26.6 Remaining Non-blocking Issues

只列**真正影响后续工作**的项（其余历史欠账见 `docs/architecture/CHANGE-AUDIT.md`）：

1. **数值型 `ENUM` 搜索域不被支持**（本轮实测，**非缺陷**）：传 `{mode:"ENUM", values:[…]}` 会被
   `PARAMETER_SEARCH_DOMAIN_UNCOMPILABLE` **响亮拒绝**，并提示改用 `INTEGER_RANGE` / `DECIMAL_RANGE`。
   影响：非等步长的候选值集合**无法直接表达**（只能靠等步长区间近似）。**不阻塞**当前运行。
2. `BD-12`（`docs/evidence/README.md` 缺 `9cg` / `9ch` 两轮索引节）、`BD-10`、`BD-14`、`BD-16`、
   `BD-18`、`BD-19`、`BD-20`：保持登记状态，本轮**未代补**（记录优先于代改）。
3. 本轮新登记 **3 条「判据自身写错」**（全部是我自己的探针判据，**0 条产品缺陷**）：
   ⒜ 步骤 0 的宽容断言（「`=== 390002` **或** 为 null」——后者恒真，把「坐标能否从文档派生」整个跳过）；
   ⒝ `describeSensitivity` 的**桶内聚合**会把其他参数的差异挂到本参数名下（读者必然误读）⇒ 改为**配对比较**；
   ⒞ `evaluated + reusedFromCache === 组合数` 把两者当**互斥**，实际是 `reused ⊆ evaluated`
   （缓存复用**也是**一次评估）⇒ 实测 expand 轮被误判 FAIL。
   ⚠️ 三条**都已在探针内标注「为什么错」并修正**，不是只把颜色刷绿。

### 26.7 ROADMAP

- `STRATEGY-RESEARCH-BRIDGE-001` ⇒ **COMPLETE**（`BD-21` 已闭环）。
- **`NEXT: Parameter Search — Actual Research Run`**（本轮已完成第一轮 smoke + 第二轮 expand；
  后续扩大规模 / 换窗口 / 进入 Robustness / OOS / WFA 均由用户裁定 —— 本轮**不**自动进入）。
- 未创建 `STRATEGY-BRIDGE-CLOSEOUT-001` / `PARAMETER-AUDIT-xxx` / `ROBUSTNESS-AUDIT-xxx` /
  `OOS-AUDIT-xxx` / `WFA-AUDIT-xxx`（规格 §十 明令）。

---

*本节生成于 2026-09-21 · 编号 `9cm`（收尾，不新开编号）· 数字全部由落盘证据现算。*
