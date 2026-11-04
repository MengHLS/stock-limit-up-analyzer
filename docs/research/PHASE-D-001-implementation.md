# PHASE-D-001 实施报告 — Research Evidence → Candidate 确定性派生桥

- **编号**：`9cb`（ROADMAP §44.5；台账两处已同步）
- **事项**：`rb1KTe`
- **前置**：`PHASE-B-001`（`9ca`）已 COMPLETE；`PHASE-R1-001`（`9bz`）已 COMPLETE
- **日期**：2026-09-20
- **边界**：零 migration / 零新表 / 零新列 / 零新依赖；未重写任何既有引擎；未建第二套 SoT

---

## 一、一句话结论

把「**人必须把研究结论重新手写一遍成策略规则**」这条断链补上：以 **Pattern 语义声明为唯一翻译层**，
从 `Finding` 的结构化条件派生出**策略侧**字段引用，并把规则、来源、**未能翻译的条件**与**方向差异**
全部如实写进候选的 provenance 快照；真实 DB 端到端已验证
`Pattern → Dataset → Run → Analysis → Finding → Conclusion → Candidate → Strategy` **全链闭合**。

---

## 二、D.1 的断链：审计到的真实形态

| 事实 | 位置 | 说明 |
| --- | --- | --- |
| 草图 5 列**只来自 `input.overrides`** | `strategyCandidate/service.ts#createFromConclusion`（步骤 8） | 修复前：不传 `overrides` ⇒ 5 个 `*Json` 列全 NULL ⇒ **没有任何研究证据进入候选** |
| 研究侧变量名 ≠ 策略侧字段引用 | `definitionBuild.ts#buildConditions`（:430-440） | 策略侧引用必含 `.`（`prefix.rd-1.close` / `event.turnover` / `bar.close`）；研究侧变量名（`pullback_holds_event_open_2d`）不含 ⇒ 注释原文写着「**两侧没有自动翻译**……机械翻译会静默引入语义错误」 |
| 既有 `patternId` 路径只能写**空 filterRule** | `researchPlannerRouter.ts`（`filterRule = { groups: [] }`） | 该注释的结论在 B 之前成立；**B 之后对 `pat_*` 语义变量已不成立** —— 本阶段正是把这条路打通 |
| `sourceFindingIdsJson` / `sourceHypothesisId` **列在但 `createFromConclusion` 从不写** | `drizzle/schema.ts:1902 / 1910`；`researchCore/repository/db.ts#create` 已支持 | 同一张表上「分析条件派生」路径写、结论派生路径不写 ⇒ 口径不一致 |

**关键发现（决定了本阶段的可行性）**：`conclusion.findingIds` 是既有的**谱系锚**（`research_conclusion.findingIdsJson`），
`research_analysis_condition` 是**结构化**条件的唯一权威（而非 `finding.dimensionJson.conditionRule` 那种人读字符串），
而 PHASE-B-001 已交付「Pattern 声明 →（研究侧变量定义 + 策略侧特征投影）」的唯一 Expander。
三者串起来，「确定性翻译」才第一次具备结构基础。

---

## 三、交付

| 文件 | 类型 | 角色 |
| --- | --- | --- |
| `server/research/strategyCandidate/evidenceDerivation.ts` | **新增** | 派生器（**唯一实现**）：`deriveCandidateRules` / `buildSemanticIndex` / `computeDerivationFingerprint` / `buildDerivationSnapshot`；纯函数、零副作用、不读时钟 |
| `server/research/strategyCandidate/service.ts` | 改 | 新增装配函数 `deriveCandidateEvidence`（读库 + Pattern 反查 + 结构化条件预取）；`createFromConclusion` 接线：`overrides` 优先、缺省用派生；补写 `sourceFindingIds` / `sourceHypothesisId`；快照加 `derivation` 段；新增入参 `deriveFromEvidence` |
| `server/research/strategyCandidate/router.ts` | 改 | `createFromConclusionInput` 增 `deriveFromEvidence?: boolean`（缺省 true = 默认派生） |
| `client/src/components/research/RuleDerivationCard.tsx` | **新增** | D.9 的 human review gate：展示「研究侧原文 → 策略侧条件 → 来源 Finding」、未翻译登记、方向不一致警告；`readDerivation` **导出**以便纯逻辑测试 |
| `client/src/adapters/strategyCandidateAdapter.ts` | 改 | `CandidateRawLike` 增 `sourceTraceJson?: unknown`（不在 adapter 层发明第二套 derivation 类型） |
| `client/src/pages/research/StrategyCandidateDetail.tsx` | 改 | 挂载 `<RuleDerivationCard raw={raw} />` |
| `tests/server/research/strategyCandidate/evidenceDerivation.test.ts` | **新增** | 19 例 |
| `tests/client/src/components/research/ruleDerivationCard.test.ts` | **新增** | 5 例 |
| `docs/evidence/_e2e_d_evidence_bridge.mts` | **新增** | 真实 DB 端到端（走 tRPC 全链，13 项检查） |
| `docs/evidence/_probe_d_evidence_shape.mts` / `.out.json` | **新增** | 只读形态审计（Finding / Conclusion / Candidate 真实列形态） |
| `docs/evidence/_probe_d_conditional_shape.mts` / `.out.json` | **新增** | 只读诊断（CONDITIONAL result 形态；定位 `pat_*` 无区分度） |
| `docs/evidence/_probe_d_finding_config.mts` / `.out.json` | **新增** | 只读诊断（反查「能产 Finding 的 analysis 配置」） |

### 派生器的三条硬纪律（写进代码注释）

1. **只用结构化条件**：权威来源是 `research_analysis_condition`，不是 `dimensionJson.conditionRule` 字符串
   （解析字符串等于凭空发明文法）；
2. **不可翻译 ⇒ 如实登记，绝不猜**：5 类 `skipped`（无结构化条件 / 非语义变量 / 无执行侧投影 /
   含 OR 语义 / 阈值参数未声明），每条带原因 + 源 finding + 源 analysis；
3. **方向差异「派生 + 登记」，不拒绝也不静默**：研究侧条件与执行侧门槛是**两个层面**
   （真库实测 `pat_pullback_hold_depth_2d >= 0` 表达「存在性」、执行侧 `bar.haircutFromEventLow <= max_drawdown`
   表达「幅度上限」）⇒ 硬要求方向一致会把**全部合法条件误杀**。故翻译照做（执行侧以**声明**为准），
   差异以 `directionMismatch` + `directionNote` 摆到人眼前。

### D.5 provenance 的落点（**零 migration**）

| 要求 | 落点 | 本阶段动作 |
| --- | --- | --- |
| `sourceConclusionId` | `conclusionId` 列 | 已有 |
| `sourceFindingIds` | `sourceFindingIdsJson` 列（**早已存在**） | ✅ 补写（此前从不写） |
| `sourceAnalysisIds` | `sourceTraceJson.derivation.evidence.analysisIds` | ✅ 新增 |
| `sourceRunId` | `sourceResearchRunId` 列 | 已有（两跳解析） |
| `datasetVersionId` | `sourceDatasetVersionId` 列 | 已有 |
| `patternId` | `sourceTraceJson.derivation.patternIds`（**只记真正被引用的 Pattern**） | ✅ 新增 |
| `derivationVersion` | `sourceTraceJson.derivation.derivationVersion` | ✅ 新增（`research-evidence-derivation@1.0.0`） |

---

## 四、D.11 验收逐条

| # | 判据 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | Finding → Conclusion 内容可追踪 | ✅ | `conclusion.findingIds` → `research_finding`；快照 `evidence.findingIds` |
| 2 | Conclusion → Candidate 有真实 evidence derivation | ✅ | E2E：`filterRule` 条件数 0 → **1**（由 Finding 派生） |
| 3 | 不再必须人工重新填写完整 rule | ✅ | 同一结论**不传 overrides** ⇒ 得到 `bar.haircutFromEventLow <= max_drawdown` + 完整 entry/exit/risk/parameterSpace |
| 4 | Derivation deterministic | ✅ | 单测：同输入 / finding 顺序颠倒 ⇒ 指纹逐字节相同 |
| 5 | Candidate fingerprint 稳定 | ✅ | `computeDerivationFingerprint`（sha256 over 键递归排序的规范化 JSON） |
| 6 | 重复生成幂等 | ⚠️ **部分** | 派生指纹稳定（同输入同指纹），但**去重仍按「同结论 + 同名」**软拒绝（既有语义未改）。见「未做」第 2 条 |
| 7 | provenance 完整 | ✅ | 上表 7 项；E2E 实测 `sourceFindingIds=[360002]` |
| 8 | Pattern provenance 完整 | ✅ | E2E：`patternIds=["first-limit-pullback-hold-shrink"]` |
| 9 | Dataset Version provenance 完整 | ✅ | `sourceDatasetVersionId=390002`；provenance 行同值 |
| 10 | Human review gate 保留 | ✅ | DRAFT → REVIEW → ACCEPTED 状态机未动；新增 `RuleDerivationCard` 展示派生链（含未翻译登记与方向警告） |
| 11 | ACCEPTED → Strategy Promote 正常 | ✅ | E2E：`strategyId=cand-1020003` / `version=1.0.0` / `strategyVersionId=870001` / provenance `origin=DIRECT` |
| 12 | 首板回踩完整 E2E 通过 | ✅ | 13/13 检查项 PASS（见第五节） |
| 13 | 无黑箱参数拟合 | ✅ | 声明式翻译（Pattern `comparison` / `thresholdParam`）；阈值是**参数引用**（由 Parameter Search 定值），不写死数字、不拟合 |
| 14 | 无新的测试失败 | ✅ | 全量 `vitest run`：失败集合与基线**逐个相同**（见第六节） |
| 15 | tsc / build 通过 | ✅ | `tsc --noEmit` = **0 错 / exit 0** |
| 16 | EOL drift = 0 | ✅ | `scripts/checkEolDrift.mjs --strict` |
| 17 | 最终报告完成 | ✅ | 本文件 |
| 18 | ROADMAP 更新 | ✅ | §44.5 `9cb` + 台账行 + 铁律行 + `ROADMAP-CHANGELOG.md` |

---

## 五、真实 DB 端到端（`_e2e_d_evidence_bridge.mts`，**走 `appRouter` 真实 tRPC**）

**跑法**：`node --import tsx docs/evidence/_e2e_d_evidence_bridge.mts`（自建自清；`clean` 模式幂等）

| 步骤 | 读数 |
| --- | --- |
| §1 实验 / Run | 实验 `decisionOffsetDays=2`；Run `1200002` `COMPLETED`（14.4 s）；`detection.status=OK`；**Finding=1**（`EFFECT`） |
| §2 结论 | `conclusion #1080002` `SUPPORTED`；**`findingIds=[]`（上游缺陷，见第六节）** |
| §3 派生（不传 overrides） | `filterRule` = `[{bar.haircutFromEventLow, <=, max_drawdown}]`；`sourceFindingIds=[360002]`；`derivationVersion=research-evidence-derivation@1.0.0`；`fingerprint=1b5cc6ed2428…`；`patternIds=[first-limit-pullback-hold-shrink]`；`skipped=1`；`directionMismatchCount=1` |
| §3 对照（`deriveFromEvidence:false`） | `filterRule = null`、**无** `derivation` 段（**零回归硬证据**） |
| §3 skipped 明细 | `NOT_PATTERN_SEMANTIC_VARIABLE` ← `pullback_holds_event_open_2d`（内建守线布尔，无声明式对应 ⇒ 不机械翻译） |
| §5 promote | `strategyId=cand-1020003`、`strategyVersion=1.0.0`、`strategyVersionId=870001`；provenance 行 `{sourceCandidateId:1020003, sourceConclusionId:1080002, sourceDatasetVersionId:390002, origin:DIRECT}` |
| 结论 | **PASS（13 项检查，失败 0）** |

### 条件设计的取舍（**如实登记**）

`pat_pullback_hold_depth_2d` **单独作条件时没有区分度**，故本次闭环用**双条件**
（`pat_* > 0` AND 内建 `pullback_holds_event_open_2d == 1`）：
`pat_*` 提供「可被翻译的语义条件」，内建变量承担真实筛选。
根因与证据见第六节第 1 条。

---

## 六、🔴 本轮发现的三个上游缺陷（**如实登记，不在本阶段修**）

### 1. `pat_*` 语义变量无区分度（PHASE-B-001 遗留）

**实测**（`_probe_d_conditional_shape.out.json`，同数据集同窗口）：

| 条件 | CONDITION 桶样本数 | DIFFERENCE | 产出 Finding |
| --- | --- | --- | --- |
| `pat_pullback_hold_depth_2d <= 0` | **0** | —（无 CONDITION 行） | 0 |
| `pat_pullback_hold_depth_2d > 0` | **1718（= 全样本）** | 0（P=1） | 0 |
| 内建 `pullback_holds_event_open_2d == 1`（**对照**） | 1436 | 0.01566（P=0.0005） | **1** |

**根因（已定位到声明侧）**：`patterns/firstLimitPullbackHoldShrink.ts` 的 `definition` 写的是
`(t0Open − min(Low[T+1..T+2])) / t0Open`（**归一化回撤比例**），而语义投影只按
`field: "low" + aggregation: "MIN"` 取值 ⇒ 实际返回**最低价绝对值**（恒 > 0）。
⇒ 典型的「**声明说 A、实现算 B**」静默失效：不是「算了但没用」，而是「算的是另一件东西」。
**属 PHASE-B-001 交付缺陷**，修复要动 `shared/patternSemantics.ts` 的声明表达力（架构变更），
本阶段只登记、不越界。

### 2. 结论不写 `findingIds`（Finding/Conclusion 域）

E2E 实测：Run **已产出 1 条 Finding**（`detection.status=OK`、`findingCount=1`），
但引擎写入的结论 `findingIds` 仍是**空数组**（`engine.ts` 的 `findingIds: built.draft.findingIds ?? []`，
值来自 `buildConclusion` 的 `draft.findingIds`）。真库横截面同样如此：
**15 条结论里 12 条 `findingIdsJson` 为 NULL、3 条为空数组**。

⇒ `D.1` 写的「Conclusion 虽然保存了 Findings」**在列上不成立**（它只存在于 `evidenceJson.findings`）。
E2E 为此加了**显式标注的脚手架**（把真实 Finding id 回填到结论上）才能继续验证派生链；
探针里放了一条**哨兵断言**（`§2 【哨兵】上游结论仍不写 findingIds`）—— 上游修好后它会变红，
提醒后人撤销脚手架。

### 3. 手工建 analysis 必须显式给 `moduleKey`

Pattern 反查链是 `Finding.primaryAnalysisId → research_analysis.moduleKey → findPatternByResearchModuleKey`。
产品路径由研究规划器写入该列；**手工**建 analysis 时若不给 `moduleKey` ⇒ 反查失败 ⇒
拿不到 Pattern 草图 ⇒ 参数空间为空 ⇒ 语义条件被登记为 `THRESHOLD_PARAM_NOT_DECLARED`。
（本条属**探针/脚本的坑**，已写进探针注释；**不是产品缺陷**。）

---

## 七、未做 / 边界

1. **`recommendedThreshold` 类「从证据推断阈值数值」** 刻意不做 —— D.3 禁止「AI 自动拟合阈值 /
   从历史数据生成不可解释规则」。派生只产出**参数引用**，取值交给 Parameter Search；
2. **幂等去重仍按「同结论 + 同名」**（既有语义），**未**改成按派生指纹去重：
   改它会与「同一结论允许多份不同名候选」的既有裁定冲突（需先裁定口径）；
3. **`researchPlannerRouter` 的 `patternId` 路径未改** —— 它在 B 之后仍写空 `filterRule`；
   统一两条路径属**独立小项**（本阶段只保证 `createFromConclusion` 有派生能力）；
4. **未新增任何 tRPC 端点**（D 的入参只加了一个布尔开关）；
5. **前端只做真机可达性的组件层验证**（见第八节），未做「带 derivation 的候选详情页」真机截图级验收。

---

## 八、前端可达性（D.9）

- 组件挂载点是**既有**页面 `/research/candidates/:candidateId`（`StrategyCandidateDetail`），
  位置在 `<CandidateSketchCard>` 之后，**老候选**（无 `derivation` 段）整卡不渲染 ⇒ 零视觉回归；
- 可测的判据（`readDerivation`）已导出并覆盖 5 例（正常 / 老候选 / 关闭派生 / 畸形 / 字段缺失）；
- ⚠️ **未做**「造一条带 derivation 的真实候选 + 无头浏览器量 DOM」。如实登记：
  本次 E2E **自建自清**，库里没有留下带 `derivation` 的候选供真机打开；
  要补真机验收需单独跑一次「建候选（不清理）+ CDP 量 `[data-testid="rule-derivation-card"]`」。

---

## 九、Phase C

**Phase C = DEFERRED**（照任务书末节）：未出现「至少 2 个 Pattern 需要新统计 Analysis Type 且
无法用现有 6 类解决」的情形，**不提前执行**。

---

## 十、取号

台账（真源）= §44.5 顶部「编号已用至 **`9ca`** ⇒ 下一个未占用 = **`9cb`**」；
取号前已全仓 `grep 9cb`（零实占）。文件头铁律行与 §44.5 台账行**两处已同步**为
「已用至 `9cb` ⇒ 下一个未占用 = `9cc`」。
