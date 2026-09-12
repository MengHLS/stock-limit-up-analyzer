# RESEARCH-006.1 — Research → Strategy Candidate 数据库 + Domain Model（实施证据）

> **性质**：实施 STEP。**只把「桥」建成数据库与领域层，不接业务线路。**
> **架构基准**：`docs/research/RESEARCH-006.0-architecture.md`（§7 / §8 / §9 / §10 / §12 / §13 / §15 / §16 + Q1–Q10）。
> **状态**：`RESEARCH-006.1 = COMPLETE`
> **完成时间**：2026-09-12 19:00 GMT+8（最后实查）
> **交付**：migration `0036` + 幂等 apply（真实 TiDB PASS）+ Candidate 4 新字段双仓储 + `strategy_research_provenance` 新表 + Provenance 领域类型/仓储 + 依赖边界守护测试。

---

## 0. 一句话结论

```
桥已建成：research_strategy_candidate (+4 列) ─┐
                                              ├─► 真实 TiDB 已落库，零 FK、零数据变化
strategy_research_provenance (新表 13 列)  ───┘
Domain：Candidate 4 字段读写双向完整（DB/InMemory 语义一致）、Provenance 仓储可用
仍未接线路：createFromConclusion / promote / transition / tRPC / 前端 = 全部不存在（见 §14）
```

---

## 1. 修改文件

### 新增（7）

| 文件 | 作用 |
| --- | --- |
| `drizzle/0036_research_strategy_bridge.sql` | 手写 migration（`-- @guard:` 幂等；6 条语句） |
| `scripts/applyResearchStrategyBridge.mjs` | 幂等 apply / `--dry-run` / `--check`（`information_schema` 断言，18.6 KB） |
| `scripts/verifyResearchStrategyBridge.mts` | **真实 TiDB**领域层验收（自建自清、行数守恒） |
| `server/research/strategyCandidate/types.ts` | `StrategyResearchProvenance` 领域类型 + 错误码 + 入参校验 |
| `server/research/strategyCandidate/provenance.ts` | 溯源仓储：`DbStrategyResearchProvenanceRepository` + InMemory |
| `server/research/strategyCandidate/provenanceContract.ts` | **唯一一份**契约用例（DB / InMemory 共用，构成一致性证据） |
| `server/research/strategyCandidate/index.ts` | 边界层统一出口 |

### 修改（5）

| 文件 | 改动 |
| --- | --- |
| `drizzle/schema.ts` | `researchStrategyCandidate` +4 列 +1 索引；新增 `strategyResearchProvenance` 表（13 列 + 1 UNIQUE + 3 索引） |
| `server/researchCore/types.ts` | `ResearchStrategyCandidate` +4 个 `source*` 字段（含写入边界的 doc） |
| `server/researchCore/candidates.ts` | 新增 `RESEARCH_CANDIDATE_IMMUTABLE_FIELDS` / `_GUARDED_TRANSITION_FIELDS` / `assertCandidateUpdatePatchKeys` |
| `server/researchCore/repository/contract.ts` | `UpdatePatch` 收紧（硬排除结构锚 + 来源快照）；`CreateInput` 自动获得 4 字段；`CandidateListFilter` +`sourceDatasetVersionId` |
| `server/researchCore/repository/{db.ts,inMemory.ts}` | 4 字段读写双向 + 列表过滤 + 边界断言（两实现同判据、同语义） |

### 新增测试（2）

| 文件 | 用例数 |
| --- | --- |
| `server/researchCore/candidates.updateBoundary.test.ts` | 14 |
| `server/research/strategyCandidate/provenance.test.ts` | 4（驱动 15 条契约用例） |
| `server/research/strategyCandidate/importBoundary.test.ts` | 6 |

---

## 2. Migration

`drizzle/0036_research_strategy_bridge.sql` —— 6 条语句，全部带 `-- @guard:`：

```
① column research_strategy_candidate.sourceDatasetVersionId        bigint NULL
② column research_strategy_candidate.sourceResearchRunId            bigint NULL
③ column research_strategy_candidate.sourceTraceJson                longtext NULL
④ column research_strategy_candidate.sourceDatasetDivergenceReason  varchar(512) NULL
⑤ index  research_strategy_candidate.idx_research_candidate_source_dataset_version
⑥ table  strategy_research_provenance（PK + UNIQUE + 3 KEY，ENGINE=InnoDB）
```

- **4 列全部 NULL-able ⇒ 零回填、零数据迁移**；
- `datasetVersionId = dataset_version.id` 是唯一坐标（**不新增** `datasetVersion` / `datasetId+version` / 第二套 ID）；
- **不加任何 FK**（全库一致：soft reference + 应用层校验）；
- **不建** `strategy_drafts`；**不给** `strategy_versions` / `strategy_version_datasets` 加 research 列；
- **未**碰 `drizzle/meta/_journal.json`；**未**用 `db:push` / `drizzle-kit generate`；
- 命名遵循项目「**禁带 STEP 编号**」约定（语义名 `research_strategy_bridge`）。

---

## 3. 实际 TiDB schema（`information_schema` 实查，非 Drizzle 推断）

### 3.1 `research_strategy_candidate` 新增 4 列

| 列 | 真实 `COLUMN_TYPE` | `IS_NULLABLE` | 断言 |
| --- | --- | --- | --- |
| `sourceDatasetVersionId` | `bigint` | `YES` | ✓ |
| `sourceResearchRunId` | `bigint` | `YES` | ✓ |
| `sourceTraceJson` | `longtext` | `YES` | ✓ |
| `sourceDatasetDivergenceReason` | `varchar(512)` | `YES` | ✓ |

列序断言：**基线 14 列 + 恰好这 4 列追加在后**（`schemaUnchanged.ok = true`，共 12 张表逐列比对通过）。

### 3.2 `strategy_research_provenance` 真实结构（13 列实查）

| 列 | 类型 | NULL | KEY |
| --- | --- | --- | --- |
| `id` | bigint | NO | **PRI** |
| `strategyVersionId` | int | NO | **UNI**（← `uq_strategy_research_provenance_version`） |
| `strategyId` | varchar(64) | NO | MUL |
| `strategyVersion` | varchar(32) | NO | — |
| `sourceCandidateId` | bigint | NO | MUL |
| `sourceConclusionId` | bigint | NO | MUL |
| `sourceExperimentId` | bigint | NO | — |
| `sourceResearchRunId` | bigint | YES | — |
| `sourceDatasetVersionId` | bigint | YES | — |
| `sourceDatasetLabel` | varchar(96) | YES | — |
| `sourceSnapshotJson` | longtext | YES | — |
| `origin` | varchar(16) | NO（默认 `DIRECT`） | — |
| `createdAt` | timestamp | NO | — |

---

## 4. Candidate 新字段（语义）

| 字段 | 语义 | 来源 | 可变性 |
| --- | --- | --- | --- |
| `sourceDatasetVersionId` | 「这个 Candidate 是**基于哪份数据**产生的」= `dataset_version.id` 快照 | 从 `research_experiment.datasetVersionId` **复制** | 写入后**不可改**（硬拒） |
| `sourceResearchRunId` | 来源 `research_run.id`，解决 `Conclusion → evidence JSON → Analysis → Run` 两跳问题 | `evidence.primaryAnalysis.analysisId → research_analysis.runId` | **提不出即 NULL，禁止伪造** |
| `sourceTraceJson` | 研究证据**快照**（provenance snapshot，**不是** `research_result` 第二份存储） | 调用时由 Conclusion/Evidence 结构决定 | 写入后**不可改** |
| `sourceDatasetDivergenceReason` | 仅当 Strategy 执行 Dataset ≠ Research 来源 Dataset 时非空 | 未来 `promote` 显式传入 | 一致时**必须 NULL** |

**明确不接受的语义替代**：`datasetVersion` label 当引用坐标 / `datasetId + version` 组合 / 第二套 `researchDatasetVersionId` —— 全部禁止（006.0 §9 铁律）。

---

## 5. Provenance schema（Strategy 侧溯源切面）

- **独立切面**：`Strategy Version ─┬─ 5 张投影 / └─ strategy_research_provenance`。
  **不是** `strategy_versions` 的列，**更不是** `StrategyDocument.definition` 的字段。
- **display-only**：不参与 `StrategyDefinition` / `StrategyDocument` / 指纹 / 5 投影 / validate / backtest / 参数搜索 / 模拟 / 执行 ⇒ Research 模块整个消失也不影响 Strategy 运行（Q10 = YES）。
- **全字段快照值，零 FK**：`sourceCandidateId` / `sourceConclusionId` / `sourceExperimentId` 即使上游行被删也照样保留 —— 这正是「快照而非 FK」的全部价值（006.0 §8.3）。**不设** `SOURCE_DELETED` 状态列。
- `origin ∈ {DIRECT, INHERITED}`：`DIRECT` 未来由 `promote` 产出，`INHERITED` 未来由 `cloneVersion` 继承。**本 STEP 只落地字段与仓储能力**。
- 仓储能力：`create` / `getByStrategyVersionId` / `listByStrategyId` / **`getBySourceCandidateId`（未来 promote 的幂等闸门）** / `deleteByStrategyId`（非级联，应用层显式调用）/ `deleteByStrategyVersionId`。**无 update**（历史事实快照，可改即伪造历史）。

---

## 6. 索引 / UNIQUE / FK 检查（`--check` PASS）

| 检查项 | 结果 |
| --- | --- |
| Candidate 4 列存在 + 类型 + nullable | ✓ 逐列断言通过 |
| `idx_research_candidate_source_dataset_version` | ✓ 存在（`sourceDatasetVersionId`） |
| Provenance 表 + 13 列类型/nullable/KEY | ✓ 逐列断言通过 |
| `uq_strategy_research_provenance_version` | ✓ **UNIQUE = true**，列 = `strategyVersionId` |
| `idx_strategy_research_provenance_{strategy,conclusion,candidate}` | ✓ 3 个索引列名匹配 |
| FK：Candidate / Provenance / **全库** | **0 / 0 / 0** |
| 既有 12 张 research_* 表列签名 | ✓ 逐列比对基线，**零意外变化**（Candidate = 14 + 4） |
| Strategy 零污染：`strategy_versions` / `strategy_version_datasets` 无 research 列 | ✓ |
| `--check` 幂等重放 | ✓ PASS（`failures = []`） |
| 第二次 `apply` 幂等 | ✓ 6 条语句全部 `skipped`，仍 PASS |

**UNIQUE 是真实数据库约束的独立证明**（绕开应用层先查后插）：裸 SQL 插入哨兵行 → 裸 SQL 重复插入 ⇒ `ER_DUP_ENTRY`（`scripts/verifyResearchStrategyBridge.mts` 输出「裸 SQL UNIQUE 复核 —— PASS」），随后哨兵行被删除。

---

## 7. 真实数据行数前后对比（逐表守恒，`apply` 前 → 后）

| 表 | 前 | 后 | 表 | 前 | 后 |
| --- | ---: | ---: | --- | ---: | ---: |
| `research_experiment` | 2 | 2 | `research_artifact` | 0 | 0 |
| `research_hypothesis` | 0 | 0 | `research_analysis_template` | 0 | 0 |
| `research_run` | 8 | 8 | `research_analysis_template_item` | 0 | 0 |
| `research_analysis` | 19 | 19 | `strategy_versions` | 0 | 0 |
| `research_analysis_condition` | 11 | 11 | `strategy_version_datasets` | 0 | 0 |
| `research_analysis_metric` | 0 | 0 | `strategy_parameters` | 0 | 0 |
| `research_result` | **674** | **674** | `strategy_entry_rules` | 0 | 0 |
| `research_conclusion` | **7** | **7** | `strategy_exit_rules` | 0 | 0 |
| `research_strategy_candidate` | **0** | **0** | `strategy_execution_rules` | 0 | 0 |
| **`strategy_research_provenance`** | （表不存在） | **0** | `dataset_version` | 2 | 2 |

⇒ **migration 未自动产生任何 Candidate**（仍 0 行）；provenance 从 0 开始（正确结果）；既有研究数据**零变化**。

---

## 8. Repository 测试

- **契约唯一化**：15 条用例只写一份（`provenanceContract.ts`），由 InMemory 与真实 TiDB **各跑一遍**，
  并断言**用例名集合逐字相同** ⇒ 这是「语义一致」的证据，而不是「两边各写一套断言」。
- Candidate 4 字段：`create` 双向往返（含 `sourceTraceJson` 对象）、缺省归一为 `null`（不是 `undefined`）、
  `list({ sourceDatasetVersionId })` 过滤、`update` 只改草图且来源/状态不动、越界硬拒（6 个字段逐项点名）、
  状态机守卫（`DRAFT→CONVERTED` 被拒、`DRAFT→REVIEW` 通过）、**自建自清**。
- Provenance：`create(DIRECT)` 全字段往返（`sourceResearchRunId` 提不出保持 `null`）、UNIQUE 冲突 →
  `STRATEGY_PROVENANCE_ALREADY_EXISTS`、`INHERITED`、`getBySourceCandidateId`、`listByStrategyId` 升序、
  入参三类非法 → `INVALID_INPUT`、删后再删 → `NOT_FOUND`、`deleteByStrategyId` 计数。

## 9. Boundary Test

`server/research/strategyCandidate/importBoundary.test.ts`（6 用例，读源码文本 + 解析 import 说明符）：

- `server/researchCore/**` **不得** import `strategyPersistence` / `strategySchema` ✓
- `server/research/strategyPersistence/**` **不得** import `researchCore` ✓
- `server/datasetRegistry/**` **不得**反向依赖 `researchCore` / `strategyCandidate` / Strategy ✓
- **只有桥**可同时 import `researchCore` 与 `strategyPersistence` ✓（当前桥只 import 前者；006.3 加后者时此断言开始真正生效）
- 桥**不得**被 Research Core / Strategy Persistence 反向 import ✓
- 桥内部不得 import `server/research/index.ts`（legacy 复数链路，同名不同物）✓

## 10. tsc

`npx tsc --noEmit` ⇒ **RC = 0**（0 error）。

## 11. 聚焦测试

```
npx vitest run server/researchCore server/research/strategyCandidate \
              server/research/strategyPersistence server/datasetRegistry
⇒ Test Files 24 passed (24) | Tests 421 passed (421)
```

## 12. 全量测试

```
npx vitest run
⇒ Test Files 7 failed | 213 passed (220)
  Tests      15 failed | 3475 passed (3490)
```

## 13. baseline failure 对比（**逐项一致，零新增失败**）

| # | 失败文件 | 失败用例数 | 归属 |
| --- | --- | ---: | --- |
| 1 | `server/dataHealth.test.ts` | 1 | 环境依赖（基线） |
| 2 | `server/image.uploadAndRecognize.test.ts` | 1 | 环境依赖（基线） |
| 3 | `server/limitUp.test.ts` | 1 | 环境依赖（基线） |
| 4 | `server/limitUp.watch.test.ts` | 4 | 环境依赖（基线） |
| 5 | `server/marketData.test.ts` | 4 | 环境依赖（基线） |
| 6 | `server/tushare.secret.test.ts` | 1 | 无 `TUSHARE_TOKEN` |
| 7 | `server/tushareTradingCalendar.test.ts` | 3 | 网络超时 |

⇒ **7 文件 / 15 例，与既有基线完全相同**；新增的 24 条测试全部通过。**未**为过测试修改任何快照或期望。

---

## 14. 未实施的 006.2 / 006.3 / 006.4 / 006.5（§29「严禁偷跑」核对）

| 必须仍不存在 | 实查 |
| --- | --- |
| `research.strategyCandidate.createFromConclusion` | ✗ 不存在 |
| `research.strategyCandidate.promote` | ✗ 不存在 |
| Candidate 前端登记按钮 / 编辑流程 | ✗ 不存在（`CandidatesPanel.tsx` 未改） |
| Strategy Provenance UI | ✗ 不存在 |
| Research → Strategy 自动转换 | ✗ 不存在 |
| `strategy_versions` 自动生成 | ✗ 不存在（仍 0 行） |
| `strategy_drafts` 表 | ✗ 不存在 |
| `candidate.create` 被任何业务代码调用 | ✗ 仍为 0 处（仅契约测试自建自清） |
| Candidate 新状态（`PUBLISHED` 等） | ✗ 未新增（六态不变） |
| 修改 `StrategyService` 行为 | ✗ 未改（provenance 尚未接入 `saveVersion`） |

**下一步**：`RESEARCH-006.2`（Conclusion → Candidate Service）—— 校验链 + `get` / `update`（白名单摘除 `status`）/ `transition`（**拒绝 `CONVERTED`**）+ router 注册；**不实现 promote、不写任何 `strategy_*` 表**。

---

## 15. ⚠️ 实施过程中发现并已裁定的**规则冲突**（必须登记）

006.1 §15 要求「`status` / `strategyDefinitionId` / `conclusionId` / `experimentId` **均不可**经普通 Candidate update 修改」。
但实查发现：

1. `server/researchCore/repository/inMemory.test.ts`（RESEARCH-001 验收，**既有基线**）用
   `update({ status })` 显式走完 `DRAFT→REVIEW→ACCEPTED→CONVERTED`，并断言非法迁移被拒 ——
   把这两个字段从仓库层摘出会**直接破坏既有验收**（违反 006.1 §26「测试结果与 baseline 可解释」与 §16「不要修改状态机」）。
2. 006.0 §10.1 对此**已有裁定**：`status` 从「通用 update 白名单」摘出是**API 层（006.2）**的职责，
   仓库层保留状态机守卫路径。

**裁定（本 STEP 采用）**：把字段分成两类，边界同样明确、且不破坏基线：

```
① 硬拒（结构锚 + 历史快照）        experimentId / conclusionId / 4 个 source*
   → 类型层排除 + assertCandidateUpdatePatchKeys 运行时响亮失败（6 字段逐项点名，已被契约测试覆盖）

② 状态机守卫（不是放开，是只能按 CANDIDATE_TRANSITIONS 走）
   status / strategyDefinitionId
   → assertCandidateTransition + assertCandidateConversionCoherence（既有语义，未改）
   → 006.2 的 API 层必须再把它们从通用 update 白名单摘出；006.3 起 CONVERTED 只能由 promote 到达
```

⇒ 已把该裁定写入 `researchCore/candidates.ts` 顶部注释、`repository/contract.ts` 的 `UpdatePatch` 文档、
`drizzle/schema.ts` 的表注释，并在 `candidates.updateBoundary.test.ts` 中断言「两个清单无交集」以防未来漂移。

---

## 16. 证据文件清单

| 证据 | 路径 |
| --- | --- |
| 前状态只读审计（真实 TiDB） | `_r0061_probe.mjs` → `_r0061_probe_result.md` |
| migration 首次 apply 断言 | `_r0061_apply.json`（`pass=true`，6 executed / 0 skipped） |
| 幂等重放 | `_r0061_apply2.json`（6 skipped / `pass=true`） |
| `--check` 断言 | `_r0061_check.json`（`pass=true`） |
| 领域层真实库验收 | `scripts/verifyResearchStrategyBridge.mts` → `_r0061_verify.log`（50 ✓ / 0 ✗） |
| 全量测试 | `_r0061_fulltest.log` / `_r0061_fulltest.clean.log` |
