# RESEARCH-FINDING-001 — 实施报告（Research Finding & Hypothesis Engine）

> 任务号 `9as`。本报告是**唯一**实施报告（§36「不要再创建多个零散报告」），
> 与 Phase A 的 `RESEARCH-FINDING-001-audit.md`（架构审计）互补：审计回答「改哪里、为什么」，
> 本报告回答「改了什么、怎么验收」。B1–B3 见审计 §8 方案，B4–B9 为本次实施，B10 即本报告。

---

## 1. Architecture Audit

结论：**Result / Finding / Conclusion / Hypothesis / Candidate 五层职责已严格分离，无重复主链路。**

| 层 | 职责 | 关键不变量 |
|----|------|-----------|
| Result | 一次 Analysis 的原始统计证据（不解释） | 只由 Analysis 产出 |
| Finding | 从 ≥1 条 Result 识别的**统计发现**，保留 provenance | `primaryAnalysisId` 或 `sourceResultIds` 至少一个非空（`assertResearchFinding`） |
| Conclusion | 针对 Research Question 对 ≥1 Finding 的**研究判断** | FINAL 必须引用 ≥1 Finding（`assertConclusionFinalizable`） |
| Hypothesis | 可测假设（条件/目标/视界/方向 + Finding provenance） | TESTABLE 需三件套（`assertHypothesisTestable`） |
| Candidate | 尚未转正的策略候选 | 仅 SUPPORTED/PROMOTED 假设可转（`assertHypothesisReadyForCandidate`） |

Finding Engine **复用现有 Result**（`repos.results.list({analysisId})`），**不重扫 Dataset**——
这是 §28 性能铁律，也是「无重复主链路」的关键：发现层是 Result 之上的**常数级**分析，
而非第二套全市场扫描。

## 2. Existing Architecture Reuse

| 复用点 | 位置 | 说明 |
|--------|------|------|
| Result 仓储 | `researchCore/repository` | Finding Engine 唯一数据源 |
| 结论生成器 | `researchEngine/conclusion.ts` | B5 升级（引用 Finding）而非重写 |
| 假设状态机 | `researchCore/hypotheses.ts` | §26 回写复用 `assertHypothesisTransition` |
| 候选转正 | `researchCore/candidates.ts` + `promote` | `createFromHypothesis` 复用既有 `promote` 语义 |
| 条件校验 | `researchCore/conditions.ts` | Hypothesis.conditions / Candidate.filterRule 同构复用 |
| tRPC 风格 | `_core/trpc` + `adminProcedure` | 与 `datasetRegistry/router.ts` 一致 |

**零新依赖、零新迁移运行时**（B1 的迁移已在 Phase B1 落地）。

## 3. Database Changes

- 新增表 `research_finding`（`drizzle/0038_research_finding.sql`，B1）：`experimentId` / `runId` /
  `primaryAnalysisId` / `findingType` / `title` / `summary` / `status` / `target` / `dimensionJson` /
  `sourceResultIdsJson` / 五维强度列 / `researchStrength` / `researchStrengthGrade` / `policyJson` /
  `limitationsJson` / `evidenceJson` / `fingerprint`（唯一索引，幂等键）。
- 扩展 `research_hypothesis`（7 列：`researchQuestion` / `conditionsJson` / `target` / `horizon` /
  `expectedDirection` / `expectedEffect` / `sourceFindingIdsJson` / `sourceConclusionId`）。
- 扩展 `research_conclusion`（4 列：`researchQuestion` / `findingIdsJson` / `evidenceSummary` /
  `limitationsJson` / `nextQuestionsJson`）。
- 扩展 `research_strategy_candidate`（2 列：`sourceHypothesisId` / `sourceFindingIdsJson`）。
- **零 FK**、JSON 列 `longtext`、状态列 `varchar` + 集中 TS 联合类型（遵审计硬边界）。

## 4. Domain Model Changes

- `researchCore/findings.ts`（B2）：`FindingPolicy` + `DEFAULT_FINDING_POLICY` + 六维判定阈值 +
  `composeResearchStrength`（五维加权，**缺失维度重归一化**，不补 0 惩罚）+ `FINDING_STATUS_TRANSITIONS`
  （引擎只能写 `DISCOVERED`）+ `assertResearchFinding`（provenance 硬锚）。
- `researchCore/conclusions.ts`（B5）：`CONCLUSION_STATUS_TRANSITIONS`（DRAFT↔FINAL，SUPERSEDED 终态）+
  `assertConclusionFinalizable`（FINAL 需 ≥1 Finding）+ `deriveHypothesisTargetStatus`（§26 映射）+
  `planHypothesisStatusPath`（逐级合法链）。

## 5. Finding Engine（六维确定性发现引擎）

`server/researchEngine/finding/`（B4），**确定性（非 LLM）**，同输入必同输出：

| 文件 | 职责 |
|------|------|
| `resultView.ts` | 纯解析：Result 行 → 有序分组序列（不统计） |
| `findingDetector.ts` | 四类探测：QUANTILE（单调/峰谷，退化→EFFECT）/ CONDITIONAL（真实基准→超额）/ EVENT_STUDY（视界峰）/ STABILITY |
| `findingScorer.ts` | §14 五维强度合成 |
| `findingStabilityAnalyzer.ts` | §11 时间切片稳定性 |
| `findingInteractionAnalyzer.ts` | §12 条件组合（无 Result 支撑只回传 untested，不产 Finding） |
| `findingEngine.ts` | 编排 + 落库（fingerprint 幂等） |

六维覆盖：**Effect / Sample / Benchmark / Monotonicity / Horizon / Stability / Interaction**（§6–§12）。
关键诚实点：materiality 门槛以下**不产 Finding**；基准取**真实 Result 行**（DESCRIPTIVE `MEAN` /
STABILITY `ALL` / CONDITIONAL `ALL`），拿不到即 `benchmarkUnavailable=true`，**不虚构**。

## 6. Hypothesis Engine

- 假设经 `researchEngineRouter.createHypothesis/updateHypothesis` 可**形式化**（conditions/target/horizon/direction）。
- `testHypothesis` 置 TESTABLE 时过 `assertHypothesisTestable`（三件套）；其余过 `assertHypothesisTransition`。
- Run 收口 `writebackHypothesisStatus`（B5）：结论类型 → 假设状态确定性映射，逐级推进（不跳级）。

## 7. API Changes

`researchEngineRouter`（B6）新增：`listFindings` / `getFinding` / `detectFindings` / `reviewFinding` /
`getHypothesis` / `testHypothesis` / `createCandidateFromHypothesis`；`createHypothesis` /
`updateHypothesis` 扩字段。写路径过领域守卫，错误映射稳定 tRPC code。

## 8. Frontend Changes

`client/`（B7）：`findingToVm` 适配器 + `FindingsPanel`（强度条/柱状图/review 流转/免责声明）+
`CreateHypothesisDialog`（从 Finding 提假设）+ ResearchDetail「发现」Tab。

## 9. Look-ahead / PIT Validation

- Hypothesis 条件禁止 Outcome 变量（`assertConditionsSignalSafe`，B4 已有护栏复用）。
- §21 前视测试覆盖（`findingPipeline.test.ts`「§21 Look-ahead」）。
- 真实数据验收（§12）组合条件仅在**真实 Result 覆盖**时才产 Finding，否则 `untestedInteractions`。

## 10. Performance Design

Finding Engine **只读 `research_result`**（§28）：`detect` 逐分析 `repos.results.list({analysisId})`，
**不 import `datasetReader`、不触碰 `dataset_*` / `limit_up_records`**。真实验收：Run 570001 仅读
208 行 Result 即检出 13 条 Finding（常数级，非 O(全市场)）。

## 11. Test Results

- `npx tsc --noEmit` = **0**（server + client）。
- 研究套件（`researchCore` / `researchEngine` / `researchEngineRouter*` / `researchFindingIntegration` /
  `researchEngineAdapter`）= **26 files / 433 tests 全绿**。
- 全量 `npx vitest run` = **4106 passed / 16 failed**，16 个失败全在**既有基线文件**
  （`dataHealth` / `limitUp.watch` / `marketData` / `tushare*` / `image` —— 外部 DB/API 依赖），
  **研究域零失败**（与项目既定基线逐字一致）。
- B4–B8 新增测试：`findingDetector`(23) + `findingPipeline`(15) + `conclusions`(10) +
  `researchEngineRouterFinding`(9) + `researchFindingIntegration`(2) + `researchEngineAdapter` findingToVm(3)。

## 12. Real Dataset Validation

**§27 首板回踩真实验收**（B9，探针 `docs/evidence/_probe_b9_real_data.mts`）：
真实 Dataset Version **390002** → Experiment **240002** → Run **570001**（13 个首板回踩 CONDITIONAL，
23,978 事件，只读 208 行 Result），检出 **13 条 EFFECT Finding**（真实落库 id 1~13）。

| §27 问题 | 判定 | 真实证据 |
|----------|------|----------|
| A 回撤深度 → 收益 | ✅ 检出（越深越差） | `close_ratio ≥0.98` −2.6% / `0.95~0.98` −5.1% / `<0.95` −8.8% |
| B 破位 → 收益 | ✅ 检出（破位明显差） | 未破 +2.45%（n=19080）vs 破 −10.0%（n=4664，胜率 15.7%） |
| C 组合 | ✅ 检出 | 未破 ∧ 缩量≤50% ∧ 收盘≥首板 → +17.5% |

未覆盖组合如实回传 `untestedInteractions`（20 条），**不造 Finding**。

## 13. Experiment / Run / Analysis / Result / Finding / Hypothesis / Candidate IDs

- Dataset Version **390002** → Experiment **240002** → Run **570001** →
  Analysis **540001~540013**（CONDITIONAL 首板回踩）→ Result（该 Run 208 行）→
  **Finding 1~13**（EFFECT，全 DISCOVERED）。
- （B6/B8 的 Hypothesis→Candidate 为集成测试的 InMemory 产物，真实库的 Hypothesis/Candidate 谱系
  由 §36「Strategy 层」既有闭环承接，见 `RESEARCH-STRATEGY-BRIDGE-implementation.md`。）

## 14. Remaining Issues

1. **§12 组合条件未覆盖**：Run 570001 的 20 条组合（如「未破位 ∧ 极致缩量≤30%」）无独立
   CONDITIONAL 分析支撑 ⇒ 如实回传 `untestedInteractions`，需新建分析后重跑才产 Finding。
2. **僵尸 RUNNING Run**（既有 `9h`）：`tsx watch` 热重启会杀在途 Run，需 boot 回收钩子。
3. **连接池地雷**（既有 `9aq`）：`maxIdle === connectionLimit` ⇒ `idleTimeout` 死配置。
4. **既有 8 条策略声明未回填**（既有 `9ar` 遗留）：需按新写法重新转正。

## 15. Legacy Code Handling

- **未删除任何 legacy 主链路**（§30 答案见审计 §3）：新旧链路并存，新 Finding 层是 Result 之上的
  增量，不触碰 legacy `/backtest` / `limit_up_records` 信号链。
- 读路径向后兼容：`validateCanonicalStrategyDefinition` 只扩白名单不拒既有形态。

## 16. 下一阶段建议

按 §37 边界，**不再扩展 Research**，进入：Strategy → Parameter Search / Optimization → Backtest →
Backtest Result → Evaluation → OOS / Walk Forward / Robustness。Research 退化为「发现问题 / 验证假设 /
解释回测结果 / 发现失效原因 / 提出 Strategy V2」的常驻能力。

---

## 附：B4–B10 提交清单

| 提交 | 范围 |
|------|------|
| `9565cd6` | B4 六维 Finding Engine |
| `d95e816` | B5 结论升级 + 引擎接线 |
| `4bf2661` | B6 tRPC 端点 |
| `0b7136e` | B7 前端 |
| `6e4bb20` | B8 闭环集成测试 |
| `761f2fd` | B9 真实数据验收 |
| （本报告提交） | B10 文档 + Master Control |
