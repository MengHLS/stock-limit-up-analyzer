# RESEARCH-STRATEGY-BRIDGE 实施报告

> 任务名：RESEARCH-STRATEGY-BRIDGE — 打通 Research → Strategy 完整研究闭环
> 实施日期：2026-09-16（北京时间）
> 前置任务：RESEARCH-006.0（架构）/ 006.1（DB + Domain Model）/ 006.2（候选业务线路）/ 006.3（promote 转正线路）/ 006.4.1-A（候选详情页）/ 006.4.1-B（领域码跨 tRPC）
> 本轮性质：**代码审计 + 真实库端到端验收 + 缺口收敛**（不重做已实现的闭环）

---

## 1. 状态

**COMPLETE**

判定依据（§17 逐条）：

| §17 判据 | 结论 | 证据 |
|---|---|---|
| Experiment → 真实 Run → 真实 Result → 真实 Conclusion → 真实 Candidate → 真实 Strategy Version 完整跑通 | ✅ | `docs/evidence/_probe_bridge_chain_trace.out.txt`（**CHAIN COMPLETE**，15 跳逐级由真实列值驱动） |
| Dataset provenance 可追溯 | ✅ | `dataset_version.id=390002 → research_experiment.datasetVersionId=390002 → candidate.sourceDatasetVersionId=390002 → strategy_research_provenance.sourceDatasetVersionId=390002` |
| Research provenance 可追溯 | ✅ | provenance 五项上游锚齐备（candidate / conclusion / experiment / run / datasetVersion）；`sourceTraceJson` 含 `primaryAnalysis.analysisId` + `runResolution` |
| Candidate 可参数化 | ✅ | 3 个参数全部 `parameterRole=TUNABLE` + `minValue/maxValue/stepValue/defaultValueJson` 齐备；真实配方 `resolveParameters` 可解析 |
| Strategy Version 独立于 Research Runtime | ✅ | `strategy_versions` 无任何 research/candidate/conclusion 列；只经 `strategyPersistence` 读口即可取到版本 + 投影 |
| Look-ahead validation 生效 | ✅ | `path.*` / `outcome.*` / 越界 `post.rd6` 三者均被 `INVALID_FUTURE_REFERENCE` 拦下；未知时间域默认拒绝 |
| Projection 与 Canonical Definition 一致 | ✅ | `verifyStrategyProjections` 5 张投影逐字段比对 **零漂移** |
| 真实数据闭环通过 | ✅ | `_e2e_research_strategy_bridge.mts`：**53 项断言 / 0 失败**，连跑 2 次同结果 |
| 测试通过 | ✅ | 全量 `vitest run` = **236 文件通过 / 7 文件失败**，失败集合与项目既有基线**逐字一致**；`tsc --noEmit` = 0 |

🔴 **必须如实说明的一点**：本闭环的**业务实现**在 006.1 ~ 006.4.1 已全部落地。本轮**没有新增任何 `server/**` 或 `client/**` 业务代码**，因为审计未发现结构性缺口。本轮的实质产出是：

1. 把「已存在但从未被一次性真实验收过」的闭环，用**真库 + 真 tRPC + 真转换器 + 真投影校验 + 真配方参数解析**跑通并留档（§11）；
2. 发现并修正 **1 处真实缺陷**：`scripts/verifyResearchStrategyBridge.mts` 的过期绝对断言（详见 §12.1）；
3. 发现并留证 **1 处真正阻塞后续 Parameter Search / Backtest 的缺陷**：条件右值无算术被静默降级成 `CONSTANT` 字符串（详见 §12.2，属已登记地雷，须单独排期）。**✅ 已于 2026-09-16 由 `9ar` / BRIDGE-CONDITION-EXPRESSION-001 修复**（派生 bar 字段 + 转换器响亮失败），见 `docs/research/BRIDGE-CONDITION-EXPRESSION-001-implementation.md`。

---

## 2. 实际调用链（审计实查，非文档假设）

### 2.1 研究链：Research UI → API → Service → Engine → DB

```text
client/src/pages/research/{ResearchList,ResearchDetail}.tsx
  └─ 子组件 client/src/components/research/*（实验 / Run / 分析 / 结果 / 结论 / 大纲 / 候选）
        │  trpc.researchEngine.*
        ▼
server/researchEngineRouter.ts                     （30 个过程：createExperiment / createRun /
        │                                            runEngine / runIncremental / createAnalyses /
        │                                            listConclusions / listCandidates / …）
        ▼
server/researchEngine/{execution,conclusion,maintenance}.ts   （引擎：执行 / 结论合成 / 维护）
        │
        ▼
server/researchCore/repository/db.ts#createDbResearchRepositories()
        │
        ▼
TiDB  research_experiment / research_run / research_analysis / research_result / research_conclusion
```

要点（实查）：
- `research_analysis` / `research_result` / `research_run` 表**零 dataset 列**；研究输入边界只在 `research_experiment.datasetVersionId`（创建即冻结）。
- 一 Run 只产**一条**结论（主分析按固定 `PRIMARY_PRIORITY` 取首个命中）⇒ 结论页必须配合结果页读。
- 结论证据形状由 `server/researchEngine/conclusion.ts` **单一构造入口**产出（`primaryAnalysis` + `contributingAnalyses` + `runResolution` + `policy` + `disclaimer`）。

### 2.2 转正链：Conclusion → Candidate → Promote → Strategy Version

```text
client/src/components/research/ConclusionPanel.tsx        ← 「Create Candidate」入口
client/src/pages/research/StrategyCandidateDetail.tsx     ← /research/candidates/:candidateId
  └─ CandidateSketchFields / CandidateSketchCard / EditCandidateDialog / PromoteCandidateDialog
        │  trpc.research.strategyCandidate.{get | createFromConclusion | update | transition | promote | getVersionProvenance}
        ▼
server/research/strategyCandidate/router.ts        （6 个端点；写端点 adminProcedure；promote 不开放 public）
        │  Router 只做 输入校验(zod strictObject) / 权限 / 调 Service / 输出 DTO
        ▼
server/research/strategyCandidate/service.ts#StrategyCandidateService
        │
        ├─ 幂等闸门：provenanceSource(sourceCandidateId)
        ├─ 状态门槛：只允许 ACCEPTED
        ├─ server/research/strategyCandidate/definitionBuild.ts   ← **唯一** Candidate→StrategyDefinition 转换器（纯函数）
        ├─ server/research/strategySchema/definitionValidation.ts#validateCanonicalStrategyDefinition（结构 + L1–L8 含 Look-Ahead）
        ├─ server/research/strategyCandidate/datasetVersionPort.ts → Dataset Registry（存在 ∧ READY）
        ├─ server/research/strategyCandidate/strategyPromotionPort.ts   ← 桥内**唯一**触 Strategy 持久化处
        │     └─ StrategyService.create → DbStrategyRepository.saveVersion
        │           （同事务写 5 张投影 + Dataset Binding 引用校验）
        ├─ server/research/strategyCandidate/provenance.ts  → strategy_research_provenance（快照，零 FK）
        └─ 回写候选 status=CONVERTED + strategyDefinitionId（**最后一步**，任何前置失败 ⇒ 零 Strategy 数据）
```

`server/research/strategyCandidate/` 是**唯一**同时看得见 Research 与 Strategy 两侧的目录，由 `tests/server/research/strategyCandidate/importBoundary.test.ts` 守护（允许清单式：`STRATEGY_PERSISTENCE_ALLOWLIST = ["strategyPromotionPort.ts"]`、`STRATEGY_SCHEMA_ALLOWLIST = ["strategyPromotionPort.ts", "definitionBuild.ts"]`）。

---

## 3. Research → Finding/Conclusion 改动

**本轮无代码改动**（已实现，实查确认）。

四层概念在现有实现中的落点：

| 任务概念 | 现有落点 | 审计结论 |
|---|---|---|
| **Result** | `research_result`（`analysisId` + `metricCode` + `dimensionJson` + `metricValue` + `sampleCount`） | 只存统计量，无任何「策略是否成立」判断 ✅ |
| **Finding** | `research_conclusion.evidenceJson` 的 `primaryAnalysis` + `contributingAnalyses[]` | 一个 Finding = 从多个 Result 提取的发现，**可追溯到 experiment / run / analysis / result** ✅ |
| **Conclusion** | `research_conclusion`（`conclusionType` ∈ SUPPORTED/PARTIALLY_SUPPORTED/REJECTED/INCONCLUSIVE） | 由 `server/researchEngine/conclusion.ts` 生成初稿，正文**强制带免责声明**；`confidence` 显式标注「不是 p 值」✅ |
| **Strategy Candidate** | `research_strategy_candidate` | 人写的假设草图，**不自动复制结论 JSON** ✅ |

真实库实测（`runResolution` 段，摘自 candidate 360008 的 `sourceTraceJson`）：

```json
{"sourceResearchRunId":570001,"path":"PRIMARY_ANALYSIS",
 "analysisIds":[540001,540002,540003,540004,540005,540006,540007,540008,540009,540010,540011,540012,540013],
 "distinctRunIds":[570001],"missingAnalysisIds":[]}
```

---

## 4. Conclusion → Candidate 改动

**本轮无代码改动**（已实现，实查确认）。

端点 = `research.strategyCandidate.createFromConclusion`（`adminProcedure`，八步校验链）。实测八项：

| 项 | 实测结果 |
|---|---|
| `status` 恒 `DRAFT`（不自动 ACCEPTED） | ✅ |
| `sourceDatasetVersionId` 只从 `experiment.datasetVersionId` 复制 | ✅ `390002` |
| `sourceResearchRunId` 经 `evidence.primaryAnalysis.analysisId → research_analysis.runId` **两跳**解析 | ✅ `570001` |
| 提不出 Run 即 `NULL`（禁伪造） | ✅（单测覆盖） |
| `sourceTraceJson` = 最小充分快照（**不是** result 第二份存储） | ✅ 3947 B / 5936 B 量级，非全量 JSON |
| `sourceDatasetDivergenceReason` 一致时必须 `NULL` | ✅ |
| 不传 `overrides` ⇒ 5 个规则列**保持为空**（Research 没研究出来的，Service 不猜） | ✅（单测覆盖） |
| `overrides` 明确拒绝 `datasetVersionId`（研究来源坐标不可被调用方改写） | ✅ |

**结论**：任务 §5「Candidate 必须携带完整 Provenance」的 5 项（experiment / run / conclusion / datasetVersion / trace）在真实库中**全部落库**，且 trace 未无限制复制 Research Run JSON。

---

## 5. Candidate → Strategy Version 改动

**本轮无代码改动**（已实现，实查确认）。

- Canonical SoT = `strategy_versions.strategyDocumentJson`（内含富 `definition`）；5 张投影表**单向派生**，`Projection → Canonical` 被禁。
- **`CONVERTED` 只有 `promote()` 能产生**：`createFromConclusion`（结构性）/ `update`（白名单闭集）/ `transition`（专属码 `STRATEGY_CANDIDATE_CONVERSION_REQUIRES_PROMOTE`）三处入口全拒。
- **幂等闸门** = `strategy_research_provenance.sourceCandidateId`；`strategyId` 确定性派生 `cand-<candidateId>`，版本号固定 `1.0.0`。
- **Dataset 绑定**：缺省 = 研究来源；改绑必须提供 `datasetDivergenceReason`，并保留原始 Research Dataset Version。

实测（详见 §11）：`promote` 一次成功产出 Strategy + Version + 5 投影 + provenance + 候选 `CONVERTED`；第二次调用 `idempotent=true`、`versionId` / `fingerprint` 逐字相同、不产生第二版本。

---

## 6. DB Migration

**本轮无新增 migration。**

桥的 migration 是 **`drizzle/0036_research_strategy_bridge.sql`**（006.1 落地），纯增量：

- `research_strategy_candidate` **+4 列 +1 索引**：`sourceDatasetVersionId` / `sourceResearchRunId` / `sourceTraceJson` / `sourceDatasetDivergenceReason`（4 列全部 NULL-able，零回填）；
- **新表** `strategy_research_provenance`（12 列 + 1 UNIQUE + 3 索引），Strategy 侧独立切面、display-only、**快照值**（不是 FK）；
- 遵循项目规范：**零 FK**、soft reference + 应用层校验；幂等 apply 脚本 `scripts/applyResearchStrategyBridge.mjs`（`-- @guard:` 先查 `information_schema` 再执行，`--dry-run` / `--check`）；**未**使用 `npm run db:push` / `drizzle-kit generate`；**未**改 `drizzle/meta/_journal.json`。

实查确认硬约束未被破坏：`strategy_versions` / `strategy_version_datasets` **无任何 research 列**，`strategyDocumentJson` / `versionRecordJson` / 指纹未被污染。

任务 §15「如果现有表结构已经满足需求：不要为了形式上的完整继续加表」——**本轮遵守**：审计发现无需加表，故零 migration。

---

## 7. API 改动

**本轮无新增 / 无修改端点。** 现有 6 个端点即任务所需的全部入口：

| 端点 | 权限 | 用途 |
|---|---|---|
| `research.strategyCandidate.get` | public | 候选详情（含上游摘要 + `sourceMissing` 如实标注） |
| `research.strategyCandidate.createFromConclusion` | admin | Conclusion → Candidate（八步校验链） |
| `research.strategyCandidate.update` | admin | 编辑研究草图（闭集白名单 7 字段） |
| `research.strategyCandidate.transition` | admin | 生命周期迁移（`CONVERTED` 明确拒绝并指向 promote） |
| `research.strategyCandidate.promote` | admin | **唯一** Candidate → Strategy 入口 |
| `research.strategyCandidate.getVersionProvenance` | public | 按 Strategy 坐标读溯源（`strategyId` + semver，不问 Research） |

研究侧端点（`researchEngine.*`，共 30 个）研究与候选登记所需者齐全（如 `listConclusions` / `listCandidates` / `runEngine` / `createAnalyses`）。

**领域码跨 tRPC 边界**已落地（006.4.1-B）：所有分支经 `withDomainCode`，领域码随 `message` 的 `[CODE]` 前缀穿越；前端唯一抠码处 = `client/src/adapters/strategyCandidateAdapter.ts#readRpcDomainCode`。本轮实测在 caller 侧可区分 6 个不同领域码。

---

## 8. Frontend 改动

**本轮无代码改动**（已实现，实查确认）。

| 任务要求 | 实现位置 | 实查 |
|---|---|---|
| 闭环流程可走完 | `client/src/pages/research/StrategyCandidateDetail.tsx`（路由 `/research/candidates/:candidateId`，刻意先于 `/research/:experimentId` 匹配） | ✅ |
| Candidate Detail 可见「研究来源 / Dataset Version / Experiment / Run / Conclusion」 | 同页 `研究来源` 段（`SourceRow` × 5，上游被删写「已不存在」） | ✅ |
| 可见 Entry / Observation / Exit / Execution / Parameters | `CandidateSketchCard` + `CandidateSketchFields`（七段结构化表单，**无 JSON 文本框**） | ✅ |
| 可见 Dataset Binding / Promotion Status | 详情页 `数据集用途` 段 + `StatusBadge` + `转正为 Strategy` 段 | ✅ |
| **Promote 前可修改交易假设** | `EditCandidateDialog` → `update`（双侧规范化比较，未改动不写库） | ✅ |
| Conclusion 页有 `Create Candidate` 入口 | `ConclusionPanel.tsx:75` → `CreateCandidateDialog` | ✅ |
| Promote 入口 | `PromoteCandidateDialog`（只提交 candidateId + 执行 Dataset + 分歧原因，**不提交 definition**） | ✅ |
| Strategy 页可见 Source Research / Source Dataset | `StrategyResearchProvenancePanel` + `getVersionProvenance`（**可缺、不阻断**） | ✅ |

---

## 9. Validation / Look-ahead

**本轮无代码改动**（已实现，实查确认 + 本轮补实测证据）。

### 9.1 字段引用与 Look-Ahead（`strategySchema/definitionValidation.ts#checkFieldReference`）

时间域文法：`prefix.rd{n}.{field}`（n≤0）/ `event.{field}` / `bar.{field}` / `post.rd{n}.{field}`（n≥1）。四类拒绝：

| 场景 | 领域码 | 本轮实测 |
|---|---|---|
| 引用 `path.*`（Dataset 明示「前视，仅打标签」层） | `INVALID_FUTURE_REFERENCE` | ✅ 命中 |
| 引用 `outcome.*`（同层） | `INVALID_FUTURE_REFERENCE` | ✅ 命中 |
| 引用越过最早信号日的 `post.rd6`（观测窗 [1,5] ⇒ 最早 T+1） | `INVALID_FUTURE_REFERENCE` | ✅ 命中 |
| 无法判定时间域的引用 | `UNKNOWN_FIELD_TIME_DOMAIN`（默认拒绝，非黑名单放过） | ✅ 命中 |
| 合法 `prefix` / `event` / `observation` 组合 | 无 `INVALID_FUTURE_REFERENCE` | ✅ 通过 |

另：`post.rdN` 的边界与观测窗口单位联动 —— 观测窗为 `CALENDAR_DAY` 时无法映射到交易日坐标系 ⇒ `SIGNAL_TIMELINE_UNRESOLVABLE`（不假装 PIT 安全）。

### 9.2 Dataset

`datasetVersionId` 存在 ∧ `status === READY` ∧ label 与 Registry `version` 一致 ∧ `datasetId` 属于该版本；唯一实现 = `strategyPersistence/datasetBindingValidation.ts`；落库前在 `saveVersion` 事务内再校验一次。错误码 `DATASET_VERSION_NOT_FOUND` / `DATASET_VERSION_NOT_READY` / `DATASET_BINDING_INVALID`。

### 9.3 Parameter

唯一名称（`PARAMETER_CODE_DUPLICATE` / `PARAMETER_CODE_FORMAT`）、合法类型、明确 role（`PARAMETER_ROLE_INVALID`）；`TUNABLE` 数值参数必须 min ∧ max、非数值必须非空 `allowedValues`（`PARAMETER_ROLE_TUNABLE_RANGE`）；`DERIVED` 必须给 `derivedFrom`（`PARAMETER_DERIVED_SOURCE`）。

### 9.4 Entry / Exit

至少一个合法 Entry（`SCHEMA_DEFINITION_ENTRY_INVALID`）；出场规则类型白名单含 `TAKE_PROFIT` / `STOP_LOSS` / `TIME_EXIT` / `SIGNAL_EXIT` / `FORCED_EXIT`（任务 §4.2 五种**全部存在**）；出场阈值不得引用不可观察数据。

---

## 10. Test Results

### 10.1 全量测试

```text
npx vitest run
  Test Files  7 failed | 236 passed (243)
  Tests      16 failed | 4040 passed (4056)
```

失败的 **7 个文件 = 项目既有基线**，集合**逐字一致**：

`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`

（基线为环境依赖类：缺 `TUSHARE_TOKEN`、外部 OCR、researchReady 快照为 `true` 等。案数 ±1 抖动属已知现象，判据是**失败文件集合**而非案数。**未**为过测试改任何快照或期望。）

### 10.2 桥专项（23 文件 / 734 例，全绿）

```text
npx vitest run tests/server/research/strategyCandidate tests/server/research/strategySchema \
               tests/server/research/strategyPersistence tests/client/src/components/research \
               tests/client/src/adapters/strategyCandidateAdapter.test.ts
  Test Files  23 passed (23)
  Tests      734 passed (734)
```

### 10.3 任务 §13 要求的测试矩阵 → 现有覆盖映射

| §13 要求 | 覆盖位置 | 状态 |
|---|---|---|
| Research：Result → Finding/Conclusion provenance | `tests/server/researchEngine/conclusion.test.ts`（13 例：证据形状单入口、主分析固定优先级、规则轨迹留痕、阈值原样写入）+ `maintenance.test.ts`（提不出 analysisId 的结论**不删**并如实计入） | ✅ 已存在 |
| Candidate：Conclusion → Candidate（runId / datasetVersionId / conclusionId / trace） | `service.test.ts` #6+7 / #8 / #9 / #9c / #10；`provenance.test.ts`（InMemory 与 DB **同一份契约**，用例名集合逐字相同） | ✅ 已存在 |
| Candidate Validation：TUNABLE / FIXED / DERIVED / 非法参数 | `definitionBuild.test.ts` 2-g / 2-h；`strategyDefinition.test.ts`（`ROLE_TUNABLE_RANGE` / `ROLE_INVALID` / `PARAMETER_DERIVED_SOURCE`）；`strategyDomainPersistence.test.ts:108`（投影保留三种角色） | ✅ 已存在 |
| Strategy Promote：ACCEPTED → Version；非 ACCEPTED → reject | `service.promote.test.ts` #7 与 #3 / #4 / #5 / #6 | ✅ 已存在 |
| Dataset Divergence：同 → 过；异 + 原因 → 过；异 + 无原因 → 拒 | `service.promote.test.ts` #10 / #11 / #12（另 #13 一致却填原因 → 拒） | ✅ 已存在 |
| Look-ahead：合法 prefix/event/observation；非法 path/outcome；非法未来 post | `strategyDefinition.test.ts` L6/L7 段（outcome / path / rd6 / rd3 / 未知时间域） | ✅ 已存在 |
| Runtime Independence | `service.promote.test.ts` #26 / #27；`importBoundary.test.ts`（10 例） | ✅ 已存在 |

**结论**：§13 未新增测试，因为每一项都已有**等价且更严**的既有覆盖。

### 10.4 静态检查

```text
npx tsc --noEmit   →  TSC_EXIT=0
```

---

## 11. 真实首板回踩闭环验证

### 11.1 常驻真实链（真实库现存，可直接复核）

追踪命令：`npx tsx docs/evidence/_probe_bridge_chain_trace.mts 360008`
输出：`docs/evidence/_probe_bridge_chain_trace.out.txt` → **CHAIN COMPLETE**

| # | 层级 | ID / 值 |
|---|---|---|
| 1 | **Dataset Version ID** | **390002**（`datasetId=120001`, `version=v2`, `status=READY`, 窗口 2024-09-01~2026-09-01, `totalEvents=23978`, `totalRows=1543082`） |
| 2 | **Experiment ID** | **240002**（「正式数据，首板回踩与未来收益的关系」，`status=COMPLETED`） |
| 3 | **Run ID** | **570001**（`runNo=8`, `status=COMPLETED`, `sampleCount=23978`） |
| 4 | Analysis IDs | **540001 ~ 540013**（13 条 `CONDITIONAL`，如 540001「观察日·T+3 未破首板最低价（买入条件线）→ 之后5日收益」/ `target=future_return_5d`） |
| 5 | Result | `research_result` 全库 4299 行；该链 13 个分析合计 208 行 |
| 6 | **Conclusion ID** | **510001**（`conclusionType=SUPPORTED`，`evidenceJson` 9022 B） |
| 7 | **Candidate ID** | **360008**（`[CAND-4GROUPS] ④-c 回撤深度≤10%（深回踩） · 守线+缩量≤30%`，`status=CONVERTED`，`sourceTraceJson` 3947 B） |
| 8 | Provenance ID | **180007**（`origin=DIRECT`, `sourceDatasetLabel=v2`） |
| 9 | **Strategy ID** | **cand-360008**（strategy 行 id 420007） |
| 10 | **Strategy Version ID** | **420007**（`version=1.0.0`, `status=Draft`, `datasetVersionId=390002`, `document` 5605 B, `fingerprint=a1c7da95…`） |
| 11 | `strategy_parameters` | 3 行（`max_drawdown` / `max_volume_ratio` / `require_bullish`，全 `TUNABLE`，含 min/max/step/default） |
| 12 | `strategy_entry_rules` | 2 行（`eventType=FIRST_LIMIT_UP`, 窗口 [1,3] `TRADING_DAY`, `triggerType=NEXT_TRADING_DAY`, `conditionCount=2`） |
| 13 | `strategy_exit_rules` | 2 行（`exit-stop-loss` STOP_LOSS/INTRADAY/RATIO 0.05；`exit-time-exit` TIME_EXIT/ON_CLOSE/TRADING_DAY 5） |
| 14 | `strategy_execution_rules` | 1 行（`signalTiming=T_CLOSE`, `executionTiming=T_PLUS_1_OPEN`, `priceType=OPEN`, `quantityMethod=TARGET_WEIGHT`, `lotSize=100`） |
| 15 | `strategy_version_datasets` | 1 行（`datasetId=first_limit_pullback`, `datasetVersionId=390002`, `role=PRIMARY`） |

全库桥侧规模：`research_strategy_candidate` 9 行（8 条 `CONVERTED` + 1 条 `ARCHIVED`）、`strategy_research_provenance` 8 行、`strategies` 9 行、`strategy_versions` 10 行。

### 11.2 本轮**新跑**的真实端到端验收（自建自清，可重复）

命令：`npx tsx docs/evidence/_e2e_research_strategy_bridge.mts`
输出：`docs/evidence/_e2e_research_strategy_bridge.out.txt` → **ALL PASS / checks=53 / failures=0**（连跑 2 次同结果）

以**同一份真实研究**（conclusion 510001）为起点，走完任务 §12 全部判定：

| §12 | 断言 | 结果 |
|---|---|---|
| ① | Conclusion → Candidate，provenance 五件套齐备（含 trace 可追溯至 `analysisId=540001` 与 `runResolution.sourceResearchRunId=570001`） | ✅ |
| ② | Promote 前编辑交易假设（`holdingDays 5→8`、`takeProfit 0.05→0.15`、`max_volume_ratio 默认值 0.3→0.5`）并落库可读；买入条件未被顺带改写 | ✅ |
| ③ | 非 ACCEPTED → promote 拒绝（`STRATEGY_CANDIDATE_NOT_ACCEPTED`）且零 Strategy 数据 | ✅ |
| ④ | Dataset 分歧三例：异库无原因 → `DATASET_DIVERGENCE_REASON_REQUIRED`；Dataset 不存在 → `DATASET_VERSION_NOT_FOUND`；同库却填原因 → `INVALID_INPUT` | ✅ |
| ⑤ | ACCEPTED → promote 生成 `strategyId=cand-<id>` / `version=1.0.0` / versionId / provenance 行（真实行） | ✅ |
| ⑥ | 投影与 Canonical Definition **零漂移**（`verifyStrategyProjections` 逐字段）+ 五张投影均有行（params 3 / entry 2 / exit 3 / execution 1 / datasets 1） | ✅ |
| ⑦ | Canonical 零污染：`strategies` / `strategy_versions` 无任何 research/candidate/conclusion 列 | ✅ |
| ⑧ | 幂等：第二次 `promote` `idempotent=true`、`versionId` / `fingerprint` 逐字相同、未产生第二版本 / 第二条 provenance | ✅ |
| ⑨ | 运行时独立性：只经 `DbStrategyRepository` 读口取版本；真实配方 `resolveStrategyRecipeById("first-limit-pullback-hold-shrink").resolveParameters(...)` 解析出 `{"max_drawdown":0.08,"max_volume_ratio":0.5,"require_bullish":1}` | ✅ |
| ⑩ | Look-ahead 负向闸门 4 例 + 合法例 1 例（见 §9.1） | ✅ |
| — | 收尾行数守恒（候选 / 策略 / 版本 / 溯源 / 参数全部回基线），研究侧记录零改动 | ✅ |

### 11.3 项目自带桥验收脚本

命令：`npx tsx scripts/verifyResearchStrategyBridge.mts`
输出：`docs/evidence/_verify_bridge_full.out.txt` → **`{"failures": [], "pass": true}`，EXIT=0**，51 项 ✓

含 19 张表的「前后逐表比对行数守恒」（全部一致）+ DB / InMemory 契约**用例名集合逐字相同**（证明两侧语义一致，而非各测各的）。

---

## 12. Remaining Issues

> 只记录**真正阻塞后续 Parameter Search / Backtest** 的问题。

### 12.1 ✅ 已修：桥验收脚本的过期绝对断言（本轮唯一代码改动）

- **文件**：`scripts/verifyResearchStrategyBridge.mts`（LF，184 行）
- **症状**：脚本报 `pass:false`，两条 failure —— 「`strategy_research_provenance` 应回到 0 行，实际 8」「`research_strategy_candidate` 应回到 0 行，实际 9」。
- **根因**：这两条断言是 **RESEARCH-006.1 阶段的事实**（当时桥刚建表、业务线路未接，全库 0 行）。006.2 / 006.3 / 006.4 接通业务后，真实库必然有真实候选与溯源行 ⇒ 「绝对 0 行」变成**假失败**。证据：同一脚本上一段 19 张表的「前后逐表比对」**全部守恒**（9→9、8→8、4299→4299…），说明脚本根本没动用户数据。
- **修法**：判据改为**自建自清** —— ① 逐表行数守恒（已有）；② 本脚本自己的哨兵行必须删净（`strategyId='c-0061-verify'` 与 `name LIKE '0061-%'`）。**禁止**再用「整表必须为 0」这类会被真实业务数据打假的绝对断言。
- **验证**：复跑 → `{"failures": [], "pass": true}`，EXIT=0。

### 12.2 ✅ **已修**（2026-09-16 · `9ar` / BRIDGE-CONDITION-EXPRESSION-001）：条件右值无算术 ⇒ 曾被**静默降级**成 `CONSTANT` 字符串

> **状态：已修。** 本条登记为 `ROADMAP.md` §44.5 的 `9ar`，已由后续任务关闭（本条已归档进 `ROADMAP-CHANGELOG.md`）。
> **修法** = 「加**派生 bar 字段**（`bar.volumeRatio` / `bar.haircutFromEventLow` / `bar.isBullish` / `bar.momentumFromEventClose`，与配方特征 **同名**）+ 转换器**取消静默降级**（算术右值**响亮拒绝** `PROMOTE_SKETCH_INVALID` 并给出改写方向）」。
> **取证与验收**：真库只读取证（16 条条件 / **7 条历史残留** / 8 条草稿重放**全部响亮拒绝**）+ 端到端复验（**27 断言 ALL PASS**、投影零漂移、`bar.volumeRatio <= max_volume_ratio` 与配方门槛**同名同义**）+ 全量测试失败集合与基线**逐字一致**。
> 详见独立报告 **`docs/research/BRIDGE-CONDITION-EXPRESSION-001-implementation.md`**。
>
> ⚠️ 以下内容保留为**修复前的现场记录（历史）**，勿据此判断当前行为。

- **严重性**：这是「已转正的 8 条策略全部带着一条**语义无意义**的入场条件」—— 不修则「回测读 `entry.conditions`」与「回测读 `recipe` 门槛」两条路径**口径不一致**，Parameter Search 会在错误的前提上搜索。
- **真实证据**（`npx tsx docs/evidence/_probe_promoted_entry_conditions.mts`，策略版本 420001~420007 全同）：

```text
definition.entry.conditions（2 条）=
   · id=cond-1 field=bar.low    GREATER_THAN_OR_EQUAL "prefix.rd0.open"        (FIELD_REFERENCE)  enabled=true
   · id=cond-2 field=bar.volume LESS_THAN_OR_EQUAL   "prefix.rd0.volume * 0.3" (CONSTANT)         enabled=true
```

- **机理**（`server/research/strategyCandidate/definitionBuild.ts#inferValueType`，判定顺序：字段引用文法 → 参数词表 → 其余 `CONSTANT`）：
  `"prefix.rd0.volume * 0.3"` 含算术 ⇒ `parseStrategyFieldReference` 返回 `unknown` ⇒ 不是参数 code ⇒ 落 `CONSTANT`（字符串）。而 `ConditionDefinition`（`strategySchema/definition.ts`）**没有算术表达式形态**，`valueType` 只有 `CONSTANT` / `FIELD_REFERENCE` / `PARAMETER_REFERENCE` ⇒ 触发已知地雷「`ConditionDefinition.value` 无算术 ⇒『相对事件日回撤 X%』表达不了」。
- **为什么本轮不修**：该地雷在 `PROJECT_RULES.md`「🔴 已知地雷（已查实 · 未修 · **全部须单独排期**）」中已登记；修法涉及 `ConditionDefinition` **加算术/表达式形态**（连带 `definitionValidation` / `projection` / `definitionBuild` 与**运行时求值**），属规格级改动，**不得夹带进本闭环任务**（任务 §14 亦禁「为规范重构」）。
- **最小扩展建议**（供排期）：给条件右值加「表达式」或派生字段（如 `bar.drawdownFromEventClose` / `bar.volumeRatioToEvent`），使「缩量 ≤ 首板量能 × 比例」能无损表达；**同时在 `definitionBuild` 加响亮失败** —— 右值既非合法字段引用、又含算术运算符时**拒绝转正**，而不是静默降级成 `CONSTANT`（与转换器既有纪律「闭集，不静默忽略」一致）。
- **对现有产物的影响**：`recipe = first-limit-pullback-hold-shrink` 的 `max_volume_ratio` / `max_drawdown` / `require_bullish` 门槛是**真实可执行**的缩量/守线判定 ⇒ 执行语义**是对的**；错的是 `definition.entry.conditions` 这条**声明**。故阻塞点是「声明与执行口径不统一」，而非「策略跑不出结果」。

### 12.3 ⚠️ 非阻塞，登记备查

| 项 | 说明 |
|---|---|
| 僵尸 Run | `research_run` 有 1 条 **PENDING 600001**（2026-09-11 遗留、非活跃）与 1 条 **FAILED 330003**；无恢复入口（`research_run` 侧尚无 dataset 那样的 `reclaimOrphan*` 兜底）。不影响本闭环。 |
| 连接池地雷 | `maxIdle === connectionLimit` ⇒ `idleTimeout` 是死配置；生产读路径 `strategyPersistence/db.ts#loadProjections` **无** `withReadRetry` ⇒ 跨境空闲连接复用偶发 `read ECONNRESET` 时，带溯源的策略页可能读失败。本轮 53 项验收**未复现**。 |
| `saveVersion` 事务边界 | 注释声称「绑定校验与写入同一事务」，但 `DbDatasetRegistry` 走池根 `getDb()`（非事务 `tx`）⇒ 校验读在另一条物理连接上。低优先级，未修。 |
| `sourceTraceJson` 不含 datasetVersionId | trace 覆盖 experiment / conclusion / analysis / run；Dataset 坐标在候选 `sourceDatasetVersionId` 列与 provenance 行上，**可追溯但不重复存放**（刻意的「单一事实」）。 |

---

## 附：本轮新增/修改的文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `scripts/verifyResearchStrategyBridge.mts` | **修改** | 修复过期绝对断言（§12.1） |
| `docs/evidence/_probe_bridge_chain_state.mts` + `.out.txt` | 新增 | 13 级链路现状全盘（列名由 `information_schema` 驱动） |
| `docs/evidence/_probe_bridge_chain_trace.mts` + `.out.txt` | 新增 | 单链贯通追踪（15 跳逐级由真实列值驱动） |
| `docs/evidence/_e2e_research_strategy_bridge.mts` + `.out.txt` | 新增 | 真实端到端验收（53 断言，自建自清） |
| `docs/evidence/_probe_candidate_param_defaults.mts` + `.out.txt` | 新增 | 转正后参数默认值完整性（运行时命门） |
| `docs/evidence/_probe_candidate_sketch_full.mts` + `.out.txt` | 新增 | 候选草图逐列全文（给验收提供「已证明可转正」的形状） |
| `docs/evidence/_verify_bridge_full.out.txt` | 新增 | 项目自带桥验收脚本全量输出 |

**未改动**：`server/**`（553 文件，零改动）、`client/**`、`drizzle/**`、任何测试文件。另按项目总控纪律更新了 `ROADMAP.md`（§44「上轮实查」换成本轮结论、§44.5 新增排队项 `9ar`、编号台账 `9aq → 9ar` 且「下一个未占用」推进到 `9as`；旧「上轮实查」归档进 `ROADMAP-CHANGELOG.md`）—— **只增删条目，无结构性改动**。

> 重跑探针须在**项目根目录**执行（`npx tsx docs/evidence/<name>`）：脚本按 CWD 写输出、按 `../../` 找源码。
