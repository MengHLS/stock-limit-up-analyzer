# RESEARCH-FINDING-001 Phase A — 现有架构审计报告

> 审计时间：2026-09-16 16:20 GMT+8
> 审计对象：`drizzle/schema.ts` + `server/research/` + `server/researchCore/` + `server/researchEngine/` + `server/strategy/` + `client/src/{pages,components}/research/`
> 审计方式：**读代码 + 实查真实 TiDB**（`information_schema` + 行数），非历史报告转述
> 证据：`docs/evidence/_probe_research_finding_audit.mts` / `.out.txt`
> 结论去向：Phase B 实施（任务号 `9as`）

---

## 0. 审计结论摘要（TL;DR）

| # | 事实 | 对 RESEARCH-FINDING-001 的影响 |
|---|---|---|
| 1 | **新 Research 主链路已完整存在**：`server/researchCore/`（领域+仓储）+ `server/researchEngine/`（分析引擎）+ `researchEngineRouter` | ✅ **不新建第二套 Research**；本任务在其上加 Finding 层 |
| 2 | **`research_hypothesis` 表已存在且已接线**（仓储 / tRPC / 引擎读取），但 **0 行** | ⚠️ 假设域**不是新建，是升级**；「结构化条件 / target / horizon / expectedDirection」需**扩列** |
| 3 | **`research_conclusion` 已存在**（12 行），由 `buildConclusion()` 规则型自动产出 | ⚠️ 结论**不是新建，是升级**；需补 `researchQuestion / findingIds / limitations / nextQuestions` |
| 4 | **`research_strategy_candidate` 已存在**（9 行）、`strategy_research_provenance` 已存在 | ✅ **不新建第二套 Candidate → Strategy**（任务书 §19 的要求已被满足） |
| 5 | **`research_finding` 表不存在**；全库**无任何**含 `finding` 的表名或列名 | 🔴 **Finding 是本任务唯一的真正新增实体**（新建 1 张表） |
| 6 | `research_result` 已有 **5083 行**真实结果（GROUPED 4060 / SCALAR 1023） | ✅ Finding Engine 有**真数据可消费**，且**无需重扫 Dataset**（符合 §28） |
| 7 | **无 benchmark 概念**（引擎只产 `DIFFERENCE` = 条件组 − 全样本） | 🔴 按 §8 必须落 `benchmarkUnavailable`，**不得虚构** |
| 8 | 多视界 = **多行 Result**（`dimension={horizon:h}` ），非多分析、非多 metricCode | ✅ Horizon Consistency 可在 Result 层直接做，**零额外取数** |
| 9 | legacy 复数表（`research_experiments` 0 行 / `research_runs` 2 行）**不在任何主链路** | ✅ 按 §30 处理：**不删、标记、不接入** |
| 10 | 在途检查：**0 个 RUNNING/PENDING Run**；1 个 PENDING Analysis（#270008，属 **FAILED** Run 330003，2026-09-11 遗留孤儿）；**3000 端口空闲** | ✅ 可安全改 `server/**` |

**一句话**：任务书假设的「可能什么都没有」并不成立 —— **Research 主链路已经建好，只差「Result → Finding」这一跳**，以及把已存在的 Hypothesis / Conclusion 从「文字容器」升级为「结构化可验证域」。本任务的真正新增面比任务书设想的小，但**升级面比它设想的大**。

---

## 1. 审计方法与证据

### 1.1 方法

```
① 读历史审计（docs/research/RESEARCH-001-AUDIT.md §4）—— 仅作线索，不作结论
② 读代码（schema.ts / researchCore / researchEngine / routers / client）
③ 实查真实 TiDB（information_schema + 行数）—— 本报告一切「事实」以此为准
④ 在途检查（改 server 的硬前置）
```

### 1.2 真库事实（`_probe_research_finding_audit.out.txt`）

**新 Research Core（RESEARCH-001/002 系）**

| 表 | 存在 | 行数 |
|---|---|---|
| `research_experiment` | ✅ | 2 |
| `research_hypothesis` | ✅ | **0** |
| `research_run` | ✅ | 13 |
| `research_analysis` | ✅ | 266 |
| `research_analysis_condition` | ✅ | 630 |
| `research_analysis_metric` | ✅ | 0 |
| `research_result` | ✅ | **5083** |
| `research_conclusion` | ✅ | 12 |
| `research_strategy_candidate` | ✅ | 9 |
| `research_artifact` | ✅ | 0 |
| `research_analysis_template` / `_item` | ✅ | 0 / 0 |
| **`research_finding`** | ❌ **不存在** | — |

**legacy（STEP 6.x / 12.6）**

| 表 | 存在 | 行数 | 主链路使用 |
|---|---|---|---|
| `research_experiments` | ✅ | 0 | ❌ 无 |
| `research_runs` | ✅ | 2 | ❌ 无 |
| `research_experiment_batches` | ✅ | 0 | ❌ 无 |
| `research_datasets` | ✅ | 7 | ⚠️ 仅 `researchDataset` 模块内部（rd-\* 指纹集，非 Registry） |

**Finding 载体搜索**：`TABLE_NAME like '%finding%'` → **0 条**；`COLUMN_NAME like '%finding%'` → **0 条**。

**数据集可用版本**

| `dataset_version.id` | version | 窗口 | events | rows | status |
|---|---|---|---|---|---|
| 390001 | v1 | 2026-08-01 ~ 2026-08-31 | 1130 | 60,002 | READY |
| **390002** | **v2** | **2024-09-01 ~ 2026-09-01** | **23,978** | **1,543,082** | **READY** |

→ 真实验收（§27）应使用 **390002**（跨 3 个年度，才可能做时间稳定性）。

**Result 实际形态**

- resultType：`GROUPED` 4060 / `SCALAR` 1023
- metricCode（real）：`SAMPLE_COUNT` 728、`MEAN_RETURN` 726、`MEDIAN_RETURN` 714、`WIN_RATE` 699、`STD_RETURN` 636、`T_STAT_DIFFERENCE` 245、`P_VALUE_DIFFERENCE` 245、`DIFFERENCE` 220、`RELATIVE_DIFFERENCE` 220、`MAX_DRAWDOWN` 153、`T_STAT`/`P_VALUE` 54、`SPREAD_TOP_BOTTOM` 25、`PAIR_*` 20、分位数若干
- analysisType：`CONDITIONAL` 220、`SEGMENT_RELATION` 20、`STABILITY` 12、`QUANTILE` 5、`EVENT_STUDY` 5、`DESCRIPTIVE` 4

---

## 2. 现有 Research 主链路全景（真实运行路径）

```
Dataset Registry（dataset_version.id）
        │
        ▼
research_experiment ──(1:N)──► research_run ──(1:N)──► research_analysis
        │                                                     │
        │                                        research_analysis_condition / _metric
        │                                                     │
        │                                                     ▼
        │                                            research_result（统计结果层）
        │                                                     │
        │                       researchEngine/conclusion.ts#buildConclusion()
        │                                                     ▼
        └───────────────────────────► research_conclusion ──► research_strategy_candidate
                                                              │  (promote)
                                                              ▼
                                                     strategies / strategy_versions
                                                     + strategy_research_provenance
```

**模块落点**

| 层 | 目录 | 文件数 | 职责 |
|---|---|---|---|
| 领域 + 仓储 | `server/researchCore/` | 13 | Domain 类型 / 枚举 / Repository（contract + db + inMemory） |
| 分析引擎 | `server/researchEngine/` | 27 | Engine 编排 / 6 类 Analysis / Metric 计算 / ConclusionBuilder / DatasetReader |
| tRPC | `server/researchEngineRouter.ts` | — | 43 个 procedure（camelCase 平面命名，读 `publicProcedure` / 写 `adminProcedure`） |
| 候选出口 | `server/research/strategyCandidate/` | 11 | `createFromConclusion` / `promote` / provenance / definitionBuild |
| 策略域 | `server/strategy/` + `server/research/strategyPersistence/` | 7 + 7 | Canonical Definition **SoT** |
| 策略/研究支撑 | `server/research/`（其余 ~260 文件） | 273 | signalEngine / costModel / parameterSearch / walkForward / robustness / oosIsolation … |

**tRPC 挂载**（`server/routers.ts#appRouter`）
`system, historicalState, researchDataset, research, datasetRegistry, researchEngine, researchRun, dataHealth, paramSearch, walkForward, marketRegime, review`

**前端**（`client/src/pages/research/` + `client/src/components/research/`）
- 页面：`ResearchDetail.tsx`（主，`/research/:experimentId`，Tabs = 执行链路 / 结果 / 结论 / 策略候选 / 变量目录）、`ResearchList.tsx`、`StrategyCandidateDetail.tsx`
- 数据层：`client/src/adapters/researchEngineAdapter.ts`（纯函数 VM 转换）+ `@/lib/trpc`
- **现状：无 Finding 面板；假设仅只读展示**（`ResearchDetail.tsx:329-347`）

---

## 3. Legacy vs New —— 任务书 §30 的答案

**结论：legacy 已事实退场，不是并发运行的第二条主链路。**

| 维度 | legacy（复数） | new（单数，RESEARCH-001 系） |
|---|---|---|
| 表 | `research_experiments` / `research_runs` / `research_experiment_batches` | `research_experiment` / `research_run` / … |
| 行数 | 0 / **2** / 0 | 2 / 13 / 266 … |
| 主键 | `id` int + 字符串业务键 | `id` bigint 代理键 |
| 输入边界 | `strategyId` + `strategyVersion`（策略驱动） | `datasetVersionId`（数据驱动） |
| 代码引用 | 仅 `server/research/persistence/db.ts` + 2 个 scripts | 主链路全量 |
| API / 前端 | **无** | 43 个 procedure + 3 个页面 |

→ **处置（§30）**：**不删** legacy 表与 `server/research/persistence/`；**不改动**；在新代码与报告中显式标注为「STEP 6.x 遗留、不在主链路、零行或近零行」；**收敛建议**见 §9.3。
→ **`research_datasets`（7 行）例外**：它被 `server/researchDataset/` 当作 rd-\* 内容指纹集**在用**，属**另一 bounded context**（数据装配缓存），**不是** Research 事实层，**不动**。

---

## 4. 任务书 §2.1 清单逐项核对

| 要求确认项 | 事实 |
|---|---|
| **表** | 见 §1.2；`research_finding` 缺失 |
| **ORM schema** | `drizzle/schema.ts:1344-1909` 新 Research 段（含醒目块注释）；`drizzle/0031~0037_*.sql` |
| **domain objects** | `server/researchCore/types.ts`（499 行，10 个实体 + 集中枚举） |
| **service** | `server/researchEngine/engine.ts`（运行编排）、`server/research/strategyCandidate/service.ts`（候选） |
| **repository** | `server/researchCore/repository/{contract,db,inMemory,index,errors}.ts`（11 接口 + 关系查询 + 聚合） |
| **tRPC / API** | `researchEngineRouter`(43) / `researchRouter`(嵌套 strategyCandidate+strategy+lifecycle+metrics) / `researchRunRouter`(6) / `researchDatasetRouter`(5) |
| **frontend 页面** | `client/src/pages/research/{ResearchDetail,ResearchList,StrategyCandidateDetail}.tsx` |
| **Engine / registry** | `server/researchEngine/analyses/registry.ts`（6 类已实现） |
| **已存在的 Finding 能力** | **无**（表、领域、服务、API、前端皆无） |
| **已存在的 Candidate 能力** | **完整**（service + router + promote + provenance） |

---

## 5. 改变计划的六条关键发现

### 5.1 多视界是「多行 Result」，不是多分析

`EVENT_STUDY` / `QUANTILE` 对每个 horizon 各产一行 `MEAN_RETURN` 等，`dimension = { horizon: h }`、`dimensionKey = "horizon"`（`analyses/eventStudy.ts:161-189`）。
→ **Horizon Consistency 是 Result 层的纯分组问题**，Finding Engine 不需要任何额外取数（§10 直接可满足）。

### 5.2 「基准」尚不存在

引擎只产 `DIFFERENCE`（条件组 − 全样本）与 `RELATIVE_DIFFERENCE`，**没有** benchmark 概念，`research_result` 也无 benchmark 列。
→ 按 §8：Finding 记录 `groupReturn` / `benchmarkReturn` / `excessReturn` 三件套，**取不到 benchmark 时置 `benchmarkUnavailable: true`**。
→ **可取的正解**：当同 Experiment 下存在「全样本子集」分析（如无条件 `DESCRIPTIVE`）时，其 `MEAN_RETURN` 可充当 **in-experiment benchmark**（**必须显式标注来源分析 id**，不得伪装成指数基准）。

### 5.3 假设状态枚举冲突（**必须拍板**）

| 任务书 §16 | 现有 `RESEARCH_HYPOTHESIS_STATUSES` |
|---|---|
| DRAFT / **TESTABLE** / **TESTED** / SUPPORTED / REJECTED / **PROMOTED** | DRAFT / **TESTING** / SUPPORTED / **PARTIALLY_SUPPORTED** / REJECTED / **INCONCLUSIVE** |

**建议**：**取并集**（向后兼容，读路径零破坏）：现有 6 值 + 新增 `TESTABLE` / `TESTED` / `PROMOTED`。理由：现有值已在 DB 列注释与 13 处代码中登记；语义上 `TESTING` ⊂ `TESTED` 不冲突（前者=进行中，后者=已测毕），`INCONCLUSIVE` 与任务书并未互斥，丢弃会造成**既有读路径**（`researchEngineRouter.updateHypothesis`）语义缺口。

### 5.4 Conclusion 的 `status` 无写路径

`research_conclusion.status` 恒为 `DRAFT`（无任何写入口）；而 `createFromConclusion` 的资格闸门是 `CANDIDATE_ELIGIBLE_CONCLUSION_STATUSES = ["DRAFT","FINAL"]`。
→ 升级 Conclusion 时必须**同时**补 `updateConclusion`（status / FINAL）与 `findingIds` 绑定，否则「结论引用 Finding」无法落地。

### 5.5 结论不自动回写假设状态

`engine.ts:307` 读假设、`:315` 写结论，二者**无状态联动**。
→ 任务书 §26 的 `Hypothesis → Tested → Supported → Promote` 链条缺一环，需在升级时补上（**写路径**，必须带守卫，避免回写污染既有 12 条结论）。

### 5.6 Finding 无 Look-ahead 风险，但 Hypothesis 有

- Finding 消费的是 `research_result`（已是 Outcome 聚合层），**天然不含样本级 Outcome**，无前视风险。
- **Hypothesis 的 `conditions` 才是前视风险面**：必须复用 `server/research/framework/leakage.ts#LeakageGuard.assertNoLookAhead`（+ `variables.ts` 的 FEATURE/OBSERVATION/OUTCOME 三角色校验），**拒绝 Outcome 变量进入条件**。
→ 任务书 §21「必须继续复用当前 Strategy Look-ahead Validator」的落点就在这里。

---

## 6. Finding / Hypothesis 缺口分析

| 能力 | 现状 | 本任务动作 |
|---|---|---|
| Finding 表 | 不存在 | **新建 `research_finding`**（1 张） |
| Finding 领域对象 | 不存在 | 新建 `researchCore/findings.ts` + types 扩展 |
| Finding 仓储 | 不存在 | `ResearchFindingRepository`（contract + db + inMemory） |
| Finding Engine | 不存在 | 新建 `researchEngine/finding/`（Detector / Scorer / Stability / Interaction） |
| Finding tRPC | 不存在 | `researchEngineRouter` 增 5 个 procedure |
| Finding 前端 | 不存在 | 新建 Findings 面板 + 证据图 |
| Hypothesis 表 | 存在（0 行） | **扩列**：`conditionsJson` / `target` / `horizon` / `expectedDirection` / `sourceFindingIdsJson` / `sourceConclusionId` / `researchQuestion` |
| Hypothesis 状态 | 6 值 | **并集扩展**（见 §5.3） |
| Hypothesis → Candidate | 不存在（只有 Conclusion → Candidate） | `service.createFromHypothesis` + 4 个 `source*` 列扩展 |
| Conclusion 升级 | 有 `evidenceJson` 无结构化 `findingIds` | 扩列 + `updateConclusion` |
| Candidate 扩展 | 缺 `sourceHypothesisId` / `sourceFindingIds` | 扩 2 列 + 写入边界守卫 |

---

## 7. 与任务书的差异与取舍

| # | 任务书表述 | 实际取舍 | 依据 |
|---|---|---|---|
| 1 | 「可能同时存在 legacy 与新版，不要建第三套」 | 建**第三套**的风险**不存在**：新链路已是唯一主链路 | §3 实查 |
| 2 | §5 建议 `server/researchEngine/finding/` 目录 | **照做**（落在既有 analysis 引擎旁，符合「复用 Analysis Engine」） | 任务书原文「具体目录以现有架构为准」 |
| 3 | §16 假设状态 6 值 | **并集**为 9 值 | §5.3 |
| 4 | §29「优先扩展现有模型」 | `research_hypothesis` / `research_conclusion` / `research_strategy_candidate` **扩列**，不建重复表 | 任务书原文 |
| 5 | §14 研究评分 5 分量 → `researchStrength` | 落 `research_finding` 结构化列（5 个 double）+ 一个加权总分；**命名禁用「策略评分」语汇** | 任务书原文 |
| 6 | §29 手工 migration / 幂等 / 无 FK | 沿用 `scripts/apply*.mjs` 的 `--> statement-breakpoint` + `-- @guard:` 幂等模式，**零 FK** | `RESEARCH-001-AUDIT.md` §1.3 |
| 7 | §36 只交一份报告 | 16 节合并在**一份** `RESEARCH-FINDING-001-implementation.md` | 任务书原文 |

---

## 8. 实施方案（Phase B，任务号 `9as`）

```
B1  DB        drizzle/0038_research_finding.sql + scripts/applyResearchFinding.mjs（幂等 + --check 断言）
              · 新建 research_finding
              · 扩 research_hypothesis（7 列）/ research_conclusion（4 列）/ research_strategy_candidate（2 列）

B2  Domain    researchCore/types.ts（Finding 实体 + 枚举 + 状态机）
              researchCore/findings.ts（Finding 域规则：状态转移 / 强度合成 / 校验）

B3  Repo      researchCore/repository/{contract,db,inMemory}.ts —— ResearchFindingRepository + findings 聚合键

B4  Engine    researchEngine/finding/{findingEngine,findingDetector,findingScorer,
                                     findingStabilityAnalyzer,findingInteractionAnalyzer,index}.ts
              · 六维：Effect / Sample / Benchmark / Monotonicity / Horizon / Stability
              · 只消费 researchCore.results.list(...) —— 绝不重扫 Dataset

B5  Wire      researchEngine/engine.ts —— Run 完成后自动 detectAndPersistFindings
              researchEngine/conclusion.ts —— 升级：结论引用 findingIds + limitations + nextQuestions

B6  API       researchEngineRouter：finding.{list,detail,detect,review,status.update}
              hypothesis.{list,detail,create,update,test}
              research.strategyCandidate：createFromHypothesis（复用既有 promote）

B7  Front     FindingsPanel / FindingDetail / CreateHypothesisDialog / EvidenceCharts
              ResearchDetail 增 Findings / Hypotheses Tab；adapters 增 findingToVm

B8  Test      单测（6 维 + 状态机 + 假设校验 + look-ahead）+ 集成（Analysis→Result→Finding→Hypothesis→Candidate）

B9  Real Data 用 dataset_version 390002 跑「首板回踩」完整研究（Finding A/B/C），如实呈现「无发现」的可能性

B10 Doc       单一报告 RESEARCH-FINDING-001-implementation.md（16 节）+ ROADMAP §44/§44.5/§47 + PROJECT_RULES 更新
```

**硬边界（全程遵守）**
- 禁 `db:push` / `drizzle-kit generate` / 新依赖 / `prettier --write`
- 零 FK；全 JSON 列 `longtext`；状态列 `varchar` + 集中 TS 联合类型
- 读路径向后兼容（`validateCanonicalStrategyDefinition` 在读路径 ⇒ 只扩不拒）
- Finding Engine **只读 `research_result`**，禁 `datasetReader`

---

## 9. 风险与遗留

### 9.1 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 扩列触发的迁移在既有 12 结论 / 9 候选上失败 | 中 | 幂等 `-- @guard: column` + `--check` 前后行数守恒断言 |
| 假设状态并集化后读路径出现未处理分支 | 中 | 先 grep 全部 `ResearchHypothesisStatus` 消费点，再并集 |
| Finding 阈值硬编码进 UI | 中 | 阈值集中为 `FindingPolicy`（与 `ConclusionPolicy` 同款），写库 + 可覆盖 |
| 真实数据跑不出「有效应」的 Finding | **高（且合法）** | §27 明确要求**如实显示「没有发现」**，不得为演示造数 |

### 9.2 在途与安全前置（已核）

- 0 个 RUNNING / PENDING Run；1 个 PENDING Analysis（#270008）属 **FAILED** Run 330003（2026-09-11），是**遗留孤儿**，非在途
- **3000 端口空闲**（dev 服务处于停止态）⇒ 改 `server/**` 不会杀死在途 Run
- `server/**` 文件数基线 = **553**

### 9.3 legacy 收敛建议（§30 要求给出）

1. **保留** `server/research/persistence/`（勿贸然删，2 行 `research_runs` 仍被 `server/dataHealth` 引用）
2. `drizzle/schema.ts` 中 legacy 段落**补一句**「不在主链路」的块注释（与 RESEARCH-001-AUDIT §4 呼应）
3. 在 ROADMAP-CHANGELOG 登记「legacy Research 表待下阶段评估下线」
4. `research_datasets`（rd-\*）**不属** legacy Research，勿混谈

---

## 10. 本阶段未做（明确边界）

- **不**增加任何新的 Analysis Type（§35.1）
- **不**新建第二套 Research Engine / Candidate → Strategy 体系（§35.2、§35.3）
- **不**实现 LLM 决定 Finding（§35.4）
- **不**让 Outcome 进入 Strategy Signal（§35.5）
- **不**自动把 Finding 变 Strategy（§35.6）
