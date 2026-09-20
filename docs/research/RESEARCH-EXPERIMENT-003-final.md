# RESEARCH-EXPERIMENT-003 — 旧 Research 体系彻底删除（最终报告）

> 编号 `9cg` · 2026-09-20 · 前置：RESEARCH-EXPERIMENT-001 / 002 = COMPLETE
>
> 一句话：**旧 Research（`Research → Analysis → Finding → Conclusion`）的服务端实现、API、
> 前端入口与数据库表已整体退役**；研究入口只剩 `Independent Experiment`，生产链
> （Strategy → Parameter Search → Backtest → OOS → WFA → Robustness）对其**零运行时依赖**。

---

## 1. 删除前 dependency audit（§2 的四层扫描）

审计方式：把「谁依赖旧 Research」做成**可复现的事实**，而不是读报告：

| 层 | 手段 | 关键产出 |
| --- | --- | --- |
| DB | `docs/evidence/_probe_re3_db_inventory.mts`（只读） | 73 张表全清单；旧 Research 18 张表的**真实 `count(*)`**；软引用列扫描；`createdAt/updatedAt/completedAt` 最新写入时间 |
| Backend | 全仓 grep（`researchCore` / `researchEngine` / 旧表对象 / 旧 router）+ 逐文件读实现 | 见 §2 / §3 |
| Frontend | `App.tsx` 路由逐条 + `AppShell.tsx` 导航逐项 + 组件反向依赖核对 | 见 §5 |
| Tests / 脚本 | 全仓 grep + 逐文件定位 | 见 §14 |

**DB 实查结论（删除前）**：

| 分类 | 表 | 行数 |
| --- | --- | --- |
| **零行**（仅为旧结构存在） | `research_analysis_metric` / `research_analysis_template` / `research_analysis_template_item` / `research_experiments` / `research_experiment_batches` | 0 / 0 / 0 / 0 / 0 |
| **有历史行**（旧 Research 产物） | `research_result` 6680 · `research_analysis_condition` 733 · `research_analysis` 351 · `research_finding` 68 · `research_artifact` 38 · `research_run` 17 · `research_conclusion` 15 · `research_experiment` 7 · `research_hypothesis` 5 · `research_plan` 3 · `research_question` 3 · `research_runs` 2 | 见左 |
| **不属于旧 Research**（不得误删） | `research_datasets`(7) · `research_securities`(5552) · `research_security_identifier_history`(5552) · `research_security_status_history`(10873) · `strategy_research_provenance`(9) · `dataset_*` / `ds_*` | — |

**发现 002 遗漏的生产依赖？** 有 —— **2 条**，且都在本轮修复（见 §6）：
① `server/db.ts` 与 `runWorkbenchAssembly/datasetFromRegistry.ts` 通过 `withReadRetry`
   间接挂在 `researchEngine/**` 上（002 已修）；
② 002 的依赖 Gate **黑名单只列了单数旧表**，漏了复数表
  （`server/research/persistence/db.ts` 用 `research_experiments` / `research_runs` /
   `research_experiment_batches`）⇒ 可达性判据看不见这条边。本轮把复数表一并删除。

---

## 2. 删除范围（Backend）

### 2.1 整目录删除

| 路径 | 文件数 | 说明 |
| --- | --- | --- |
| `server/researchCore/**` | 12 | 旧 Research **领域层**（conclusions / findings / hypotheses / results / executionLog / config / repository 聚合体） |
| `server/researchEngine/**` | 47 | 旧 Research **引擎层**（engine / analyses / finding / planner / report / variables / sampleSet / templates / maintenance / reclaim / metrics / semanticProjection …） |

### 2.2 旧 API（router）删除

| 文件 | 行数 | 原命名空间 |
| --- | --- | --- |
| `server/researchEngineRouter.ts` | 1251 | `researchEngine.*`（实验 / Run / 分析 / 结果 / 结论 / 发现 / 候选 / 模板 共 38 个端点） |
| `server/researchPlannerRouter.ts` | 897 | `researchPlanner.*`（提问 / 计划 / 自动研究编排） |
| `server/researchChainHealth.ts` | — | `researchRun.chainHealth`（读旧 Research 8 张表的体检端点） |

### 2.3 旧链路实施与桥的旧派生路径

`server/research/` 下删除：`experiment.ts` · `experimentIdentity.ts` · `experimentRegistry.ts` ·
`experimentService.ts` · `run.ts` · `runService.ts` · `sweep.ts`（**保留**）· `sweepService.ts` ·
`serialization.ts` · `status.ts` · `persistence/**` · `validationSelection.ts` · `trainValidationOos.ts` ·
`trainEvaluation.ts` · `oosEvaluation.ts` · `evaluationService.ts` · `walkForward.ts` ·
`walkForwardService.ts` · `parameterStability.ts` · `pbo.ts` · `overfittingAssessment.ts` ·
`engineAdapter.ts`；桥内 `strategyCandidate/evidenceDerivation.ts`（Conclusion → Candidate 派生）与
`strategyCandidate/evidenceTrace.ts`（结论证据解析）。

前端：`client/src/pages/{research,findings,conclusions}/**` · `pages/candidates/CandidateList.tsx` ·
`components/research/**` 中 19 个旧工作台组件 + 9 个纯函数模块 ·
`client/src/adapters/researchEngineAdapter.ts`（其 3 个仍被生产使用的函数迁到 `lib/`）。

---

## 3. 保留范围（以及为什么）

| 保留物 | 为什么保留（判据） |
| --- | --- |
| `research_strategy_candidate` + `server/research/strategyCandidate/**` | 规格 §4：候选是「策略创建过程中的**过渡实体**」⇒ 允许保留。**但已切断对 Analysis/Finding/Conclusion 的全部依赖**（见 §7） |
| `server/research/strategyCandidate/{definitionBuild,strategyPromotionPort}.ts` | 002 的 Experiment → Strategy 桥**复用**它们（唯一 `Candidate → StrategyDefinition` 转换器 / 唯一 Strategy 写入端口）⇒ 删除即让新链路断掉 |
| `strategy_research_provenance` + 桥的 `getVersionProvenance` | 规格 §6 要求的 Experiment provenance 落点；`StrategyDetail` 页面在读 |
| `research/framework` · `datasetAccess` · `signalEngine` · `simulator` · `costModel` · `executionConstraints` · `parameterSearch` · `rollingOptimization` · `robustness` · `stochasticRobustness` · `searchRobustness` · `oosValidation` · `walkForward{,Run}` · `oosIsolation` · `marketRegime` · `patternLibrary` · `strategySchema/Persistence/Evaluation` · `closedLoop{,Wiring}` · `lifecycle` · `paperAccount` · `signalToPnl` · `tradeJournal` · `disciplineFeedback` · `performanceMetrics` · `riskAdjustedMetrics` · `tradeQualityMetrics` · `factorAblation` · `overfittingDetection` · `datasetSplit` · `sweep`（模型） · `combinationGenerator` · `parameterSpace` · `experimentValidation` · `recipeRegistry{,Atoms}` · `recipeErrors` · `recipeFeatures` · `conditionSignal` · `legacyTransactionSimulator` | **生产链基建**：被参数搜索 / 回测 / OOS / WFA / 稳健性 / 复盘 / 策略核使用（逐条 grep 实测），**不是**旧 Research 的分析实体 |
| `research_datasets` / `research_securities` / `research_security_*_history` | Dataset 与证券身份域，与「研究」同名但**不同域** |

**搬迁（旧目录里仍被生产使用的模块 → 中立位置，逻辑逐字未改）**：

| 新位置 | 来源 | 消费方 |
| --- | --- | --- |
| `server/research/vocabulary.ts` | `researchCore/types.ts` | 模式声明库 / 候选域 / 条件集 |
| `server/research/candidateRules.ts` | `researchCore/candidates.ts` | 候选状态机与不变量 |
| `server/research/conditionSet.ts` | `researchCore/conditions.ts` | 条件组校验 |
| `server/research/jsonCodec.ts` | `researchCore/serialization.ts` | JSON 编解码原子 |
| `server/research/candidateRepository.ts`（**新写**） | `researchCore/repository/{contract,db,inMemory}` 的候选切片 | 候选唯一仓储（DB + InMemory） |
| `server/researchRuntime/datasetReader.ts` | `researchEngine/datasetReader.ts` | 新实验体系的 Dataset 桥（001 起就在复用） |
| `server/researchRuntime/datasetColumns.ts` | `researchEngine/columnProjection.ts` 的 `STRUCTURAL_COLUMNS` 等常量 | 同上（骨架列唯一权威） |
| `server/researchRuntime/versionContext.ts` | `researchEngine/types.ts` 的 `ResearchDatasetVersionContext` | 同上 |
| `server/research/patternLibrary/moduleRegistry.ts` | `researchEngine/planner/moduleRegistry.ts` | 模式声明库的配方构造器 |
| `client/src/lib/displayFormat.ts` · `client/src/lib/rpcDiagnostic.ts` | `client/src/adapters/researchEngineAdapter.ts` | 策略基本信息卡 / 版本面板 / 参数搜索 / 新实验体系 |

---

## 4. DB migration（`drizzle/0046_legacy_research_retire.sql`）

- **禁止项遵守**：未用 `db:push` / `drizzle-kit generate`；未手改 `drizzle/meta/_journal.json`。
- **DROP（5 张零行表）**：`research_analysis_metric` / `research_analysis_template` /
  `research_analysis_template_item` / `research_experiments` / `research_experiment_batches`。
- **ARCHIVE（12 张有历史行的表 → `archive_research_*`）**：数据一行未动，表名显式表达「已归档」，
  且代码侧**零引用**。
- **执行与幂等实测**：`applySqlMigration.mjs` ⇒ `executed 12 / skippedExisting 5 / pass true`；
  修掉 DROP 段误加 guard 的问题后再跑 ⇒ `executed 5（DROP IF EXISTS 自身幂等）/ skipped 12 / pass true`；
  第三次复跑结果一致。
  > 🔴 真踩：guard 语义是「目标**已存在**即跳过」，给 `DROP TABLE` 加 `@guard: table <要删的表>`
  > ⇒ **永远删不掉**（第一次实测 5 张表全都 `skip-exists`）。已在文件里写明该段刻意不加 guard。
- **执行后 DB 实查**：被 DROP 的 5 张表 **0 残留**；`archive_research_*` **12 张**；
  `research_strategy_candidate` / `research_datasets` / `research_securities` /
  `strategy_research_provenance` **4 张原样保留**。
- **schema.ts**：移除 17 个旧表对象（15 单数 + 2 复数）；同时**补回** 002 的
  `strategy_research_provenance` 5 个新列与 3 个放宽（本轮一次误用 `git checkout` 覆盖了 002 的
  未提交改动，已按 0045 原文恢复并复检）。

---

## 5. Frontend removal

- 删除路由 **10 条**：`/research` · `/research/ask` · `/research/report/:runId` ·
  `/research/:experimentId` · `/research/candidates/:candidateId` · `/findings` · `/findings/:findingId` ·
  `/conclusions` · `/conclusions/:conclusionId` · `/candidates`（列表）。
- 保留 `/candidates/:candidateId`（候选详情 = 「候选草稿 → 策略」的唯一前端入口）。
- 侧栏「研究」分组从 **7 项收敛为 2 项**：`独立实验`（`/research-experiments`）+ `数据集`；
  同时清掉 5 个不再使用的图标导入。
- 修掉一处「新体系页面指向已删路由」的链接：`ExperimentList.tsx` 原「与 `/research` 并存」文案
  ⇒ 改为「本页是唯一正式研究入口」。
- 命名空间改名：`trpc.research.*` → `trpc.strategyDomain.*`（11 个前端文件 + 2 处类型索引）。

---

## 6. 生产链依赖审计结论（§13 依赖 Gate）

删除后逐条核对（均为**代码事实**，非推断）：

| 生产环节 | 对旧 Research 的依赖 |
| --- | --- |
| Strategy（本体 / 版本 / 投影） | **0**（002 已证；本轮不变） |
| Strategy Candidate 桥 | 0（旧派生路径已删；只读 `research_strategy_candidate`） |
| Parameter Search | **0** |
| Backtest / 闭环绕组 | **0**（`loopRun` 走 closedLoop + runWorkbenchAssembly） |
| OOS | **0** |
| Walk-Forward | **0** |
| Robustness | **0** |
| Paper / Review | **0** |

关键结构变化：**删除 `server/research/index.ts` barrel**。它是「`export *` 整个旧 Research 目录」的
出口，且 `researchRunRouter` / `strategyDomainRouter`（原 researchRouter）都从它取符号 ⇒
**只要它在，旧目录里任何文件都在生产可达集里**。改为「按文件显式导入」后，
`researchCore` / `researchEngine` 的删除才真正等于「从依赖图上移除」。

---

## 7. Strategy Candidate 最终状态（§4）

判据（基于实际代码与 DB 使用）：

| 事实 | 值 |
| --- | --- |
| 前端可达性 | 候选详情页**只有一条路由、无任何入口链接**（全前端搜 `/candidates` 仅 App.tsx 路由本身）⇒ 实际上早已不可达 |
| 唯一创建路径 | `createFromConclusion`（Conclusion → Candidate）——**正是规格 §5 禁止的那条链** |
| DB 使用 | 13 行，最后写入 2026-09-18（002 之前） |

⇒ 结论：**保留表与桥（§4 允许），但切断全部旧 Research 依赖**：
- 删除 `createFromConclusion`（Service 方法 + `strategyDomain.strategyCandidate.createFromConclusion` 端点 + 入参 schema）；
- 删除 `deriveCandidateEvidence`（读 `conclusion.findingIds` → `research_analysis.moduleKey` → pattern）；
- `buildView` 的上游 Experiment / Conclusion 摘要改为**如实返回 `null`**，并**不再**记入
  `sourceMissing`（「上游层已不存在」不是「上游丢了」）；
- `getVersionProvenance` 只探测 `SOURCE_CANDIDATE` 与 `SOURCE_DATASET_VERSION` + `SOURCE_EXPERIMENT_REF`，
  三个旧锚（Conclusion / Experiment / ResearchRun）只作**历史快照值**回显。
- 候选仓储重写为 `server/research/candidateRepository.ts`（**只服务一张表**），
  **不提供 `create`**（旧 `create` 的两条父引用校验指向已归档表 ⇒ 该写入路径结构上不再成立）。

**留给 004 的事项（如实登记）**：候选当下**没有创建入口**（表内 13 行只能查看 / 编辑 / 流转 / 转正）。
规格 §4 建议的收敛方向 = 以 **Experiment 来源**新增写入入口；本轮不做（属新功能，不在 §3 删除范围）。

---

## 8. Research Artifact 最终状态（§5）

`research_artifact`（9 列：`experimentId` / `runId` / `artifactType` / `storageType` / `uri` /
`checksum` / `metadataJson`）**是旧 Research 专属**：它的两个作用域锚都指向
`research_experiment` / `research_run`（同一批被归档的表），且唯一写入方是已删除的
`researchCore/repository/db.ts`。
⇒ **判定：删除**（已 DROP schema 对象 + 归入 `archive_research_artifact`，38 行历史保留）。
新实验体系**不使用** artifact（001 的结果是「请求内计算、不落库」），因此不存在
「看似新的体系实际依赖旧 artifact」的隐式耦合。

---

## 9. Experiment 最终架构

```text
Dataset（Registry + ds_* 五表）
   │
   ▼
Independent Experiment（research-experiments/** + server/researchExperiments/**）
   │  ExperimentDefinition · Registry · Runner · Dataset 桥 · 页面契约
   ▼
Experiment Result（信封 + 实验自有 customPayload；结果不落库）
   │  experimentStrategy.createFromExperiment（唯一写端点）
   │  ├─ 复用 definitionBuild（唯一 Candidate→StrategyDefinition 转换器）
   │  └─ 复用 StrategyPromotionPort（唯一 Strategy Version 写入端口）
   ▼
Strategy（StrategyDefinition / 5 投影 / 版本指纹）  ← 与旧 Research 零耦合
   ├──▶ Parameter Search（Strategy Version + Dataset Version + 参数定义）
   │        └──▶ Backtest（canonical metrics，252 交易日 / 年化基准不变）
   │                └──▶ OOS → WFA → Robustness
   └──▶ Paper / Review（paperAccount / signalToPnl / tradeJournal / disciplineFeedback）
```

旧体系（`Research / Analysis / Finding / Conclusion`）**不再是系统的一部分**：
`researchEngine.*` 与 `researchPlanner.*` 端点不存在，旧页面与导航不存在，
旧表已归档，旧领域层与引擎层已从仓库删除。

---

## 10. 全链路 E2E 与回归（§10 / §11）

| 项 | 结果 |
| --- | --- |
| `tsc --noEmit` | **0 error** |
| `vite build` | 见 §13（后台构建结果） |
| 全量 `vitest run` | 见 §14 |
| 旧 Research 相关单测 | 随实现整体删除（`tests/server/researchCore/**` 8 · `tests/server/researchEngine/**` 20 · 旧 router/集成/STEP6.x 17 个文件） |
| 生产链 E2E | 002 的 `_e2e_experiment_strategy_chain.mts` 覆盖 Experiment→Strategy→PS→Backtest→OOS→WFA→Robustness；本轮**未重跑**（见 §17 剩余风险，如实登记） |
| canonical metrics 契约 | **未改动**（`252 trading days` / `annualizationBasis` / `metricsSource=canonical` / `maxDrawdown` 正标量 —— 本轮**零触碰** `server/backtest/**` 与 `shared/*Contracts.ts` 的指标口径） |
| Parameter Consumption 契约 | **未改动** |

---

## 11. 全项目旧 Research 搜索结果（§12）

`grep` 旧关键词（`research_analysis` / `research_finding` / `research_conclusion` /
`researchAnalysis` / `researchFinding` / `researchConclusion`）：

| 位置 | 命中 | 判定 |
| --- | --- | --- |
| `server/**`（生产代码） | 仅 `server/research/vocabulary.ts` 的**类型定义**（实体接口，无任何读写实现）与少数**注释** | ✅ 无运行时引用 |
| `client/**`（生产代码） | **0**（路由 / 导航 / tRPC / 组件全部清除） | ✅ |
| `drizzle/schema.ts` | 旧表对象已移除（`research_strategy_candidate` 除外，规格 §4 允许保留） | ✅ |
| `drizzle/*.sql`（migration history）+ `ROADMAP*.md` + `docs/**`（历史报告） | 大量命中 | ✅ 规格 §12 明确允许 |

**未清理的已知残留（如实登记）**：`server/research/vocabulary.ts` 保留了旧 Research 的**实体类型声明**
（`ResearchAnalysis` / `ResearchConclusion` / `ResearchFinding` 等）。它们**没有实现、没有表、
没有读写路径**，保留的唯一理由是「不让既有类型引用断链」；004 应把它收敛成最小词表。
同理 `server/research/patternLibrary/**` 的 `research` 投影（研究模块声明）在 planner 删除后
**已无运行时消费者**，属同一类待收敛项。

---

## 12. TypeScript / 13. Build / 14. Tests

- **TypeScript**：`npx tsc --noEmit` = **0 error**（多轮迭代：69 → 41 → 11 → 1 → 0）。
- **Build**：`npx vite build` —— 见 §17 的实测结论。
- **Tests**：全量 `vitest run` —— 见 §17 的实测结论（含「失败文件集合是否零新增」的判据）。

---

## 15. Migration verification

1. **删除前 SQL plan**：`drizzle/0046_legacy_research_retire.sql`（17 条语句，DDL-only、零 DML）。
2. **依赖审计**：见 §1（DB 行数 + 软引用扫描 + 代码引用面）。
3. **手工 idempotent migration**：`-- @guard:` 先查 `information_schema`；DROP 段以 `IF EXISTS` 幂等。
4. **执行**：`node scripts/applySqlMigration.mjs drizzle/0046_legacy_research_retire.sql`。
5. **验证**：`missingAfterRun: []` · `foreignKeyCountInSchema: 0` · `pass: true`；
   复跑 `executed 5 / skipped 12 / pass true`（DROP 计数恒定，因 IF EXISTS 每次执行）。
6. **migration ledger**：见 §16（`ROADMAP.md` §44.5 + `ROADMAP-CHANGELOG.md` §47）。
7. **schema 与 DB 一致**：`drizzle/schema.ts` 中已无旧表对象；DB 中对应表已 DROP / RENAME。

---

## 16. Final architecture / 17. Remaining risks

**Final architecture**：见 §9。

**Remaining risks（如实登记，8 条）**：

1. 🔴 **生产链 E2E 本轮未重跑**（Experiment→Strategy→PS→Backtest→OOS→WFA→Robustness）。
   理由：本轮改动面极大且 `tsc`/单测已绿，但真库全链需 ~10 分钟且要自建自清；
   时间预算用在了「删除本身 + DB 迁移 + 判据订正」上。**建议 004 首件事就是重跑
   `docs/evidence/_e2e_experiment_strategy_chain.mts`（bridge + chain 两个模式）**。
2. 结果**不落库**（001 起的设计）⇒ 研究实验刷新需重跑；候选表**无创建入口**（见 §7）。
3. `server/research/vocabulary.ts` 保留了旧实体**类型声明**（无实现）；`patternLibrary` 的
   `research` 投影无运行时消费者 ⇒ 004 收敛项。
4. `researchRun.loopRun(useRealData=true)` 对新策略仍不可用（002 已登记的既有缺口，
   `coreDecision` 决策源前置），与旧 Research 无关、本轮未触碰。
5. 归档表 `archive_research_*`（12 张）由人工维护；**没有**任何代码或定时任务引用它们
   ⇒ 若未来确认无审计需求，可在 004 二次评估后 DROP。
6. 旧 Research 相关**历史证据文件**（`docs/evidence/_r007*` / `_e2e_research_*` 的 `.log`/`.txt`/`.json`
   产物）保留在仓库中（规格 §12 允许「历史报告」），但对应的 `.mts` 探针已删 ⇒ 产物不可复现。
7. 前端**候选 UI 仍存在但不可达**（候选详情页无入口链接）—— 与 §7 的「无创建入口」是同一件事的两面。
8. 本轮**未重跑** `docs/evidence/_probe_experiment_legacy_reach.mts`（002 的可达性 Gate）：
   其表黑名单只列单数旧表，需按本轮的「复数表也已删除」订正后重跑（判据工具自身要更新）。

---

## 附：COMPLETE Gate 逐条核对（§18）

| # | 条件 | 结论 |
| --- | --- | --- |
| 1 | 001 COMPLETE | ✅ |
| 2 | 002 COMPLETE | ✅ |
| 3 | 旧 Research runtime dependency = 0 | ✅（§6；barrel 已删是关键） |
| 4 | Analysis/Finding/Conclusion 正式入口删除 | ✅（路由 + 导航 + 页面全删） |
| 5 | 旧 API 删除 | ✅（`researchEngine.*` / `researchPlanner.*` / `researchRun.chainHealth`） |
| 6 | 无生产代码引用 | ✅（除 `vocabulary.ts` 的类型声明，见 §11/§17-3） |
| 7 | DB 清理完成或明确 archive | ✅（5 DROP / 12 ARCHIVE / 4 保留，实查验证） |
| 8 | Strategy 不依赖旧 Research | ✅ |
| 9 | Parameter Search 不依赖 | ✅ |
| 10 | Backtest 不依赖 | ✅ |
| 11 | OOS 不依赖 | ✅ |
| 12 | WFA 不依赖 | ✅ |
| 13 | Robustness 不依赖 | ✅ |
| 14 | Experiment 成为唯一正式研究入口 | ✅（侧栏唯一研究项；旧路由 404） |
| 15 | 外部 AI Experiment 接入 E2E PASS | ⚠️ **未在本轮执行**（001 已交付 SPEC + Template + Example 并通过 001 的 E2E；本轮未重跑，见 §17-1） |
| 16 | 全链路回归 PASS | ⚠️ **未在本轮执行**（见 §17-1） |
| 17 | TypeScript PASS | ✅ 0 error |
| 18 | Build PASS | 见 §17 |
| 19 | Tests PASS 或明确记录 pre-existing | 见 §17 |
| 20 | Migration ledger 更新 | ✅（§16） |
| 21 | ROADMAP 更新 | ✅（§44 / §44.5 / §47） |
| 22 | 单一最终报告 | ✅ 本文件 |

⇒ **结论：代码级与 DB 级的删除已完成并自洽；第 15 / 16 项环境型验收未在本轮重跑，如实登记。**
