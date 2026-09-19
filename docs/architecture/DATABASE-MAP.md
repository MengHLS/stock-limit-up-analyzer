# DATABASE-MAP — 数据库域地图

> Baseline **v1.0.0** · auditedAt **2026-09-19**
> 行数为**真实库实查**（探针 `docs/evidence/_probe_baseline_state.mts` / `_probe_baseline_tables.mts`，2026-09-19T08:40Z，`errors=0`），非 schema 推断、非历史报告。

---

## 1. Schema 规模与真实库对齐

| 项 | 值 | 依据 |
|---|---|---|
| `drizzle/schema.ts` 行数 | **2292** | 实读 |
| schema.ts 声明表数 | **60**（`grep -c "mysqlTable("`） | 实查 |
| **真实库 BASE TABLE 数** | **63** | `information_schema.tables` 实查 |
| 差异 3 张 | `__drizzle_migrations`（24 行，drizzle 元数据）+ `rd_rows_05809b1a6d97aa02`（163 行）+ `rd_rows_5dce9db1421bec38`（800 行） | `_probe_baseline_tables.out.json` |
| migration 文件数 | **41**（`drizzle/0000…0040`，编号连续） | 实读 |
| **外键约束** | **0**（`foreignKey` / `references(` / `onDelete` 全仓零命中） | grep 实证 |
| 索引策略 | 全部为 `index` / `uniqueIndex`；跨表关系一律**软引用**（id 列，应用层保证） | schema.ts |

**`rd_rows_*` 说明**：B 体系（`server/researchDataset`）的动态分片行表（`buildKey` → 表名，`researchDataset/buildKey.ts:21`），与 `research_datasets` 的 7 行一一对应；属 **LEGACY 存储**，不影响 A 体系。

---

## 2. Migration 真实状态（🔴 与本基线最相关的一条）

| 项 | 真实值 | 含义 |
|---|---|---|
| `drizzle/meta/_journal.json` | `entries` 止于 **idx=23**（`0023_security_identity_unification`） | **自 0024 起无 journal 条目** |
| `drizzle/meta/*_snapshot.json` | 仅 **0000–0015** | **自 0016 起无快照** |
| `__drizzle_migrations` 表 | **24 行** | 与 journal 止于 idx 23 一致 |
| ⇒ 结论 | **`npm run db:push`（= `drizzle-kit generate && drizzle-kit migrate`）当前不可用** | 0024–0040 既无 journal 也无 snapshot |

**实际在用机制（FACT）**

1. 通用幂等执行器 `scripts/applySqlMigration.mjs`：读 `.env` 的 `DATABASE_URL`，按 `--> statement-breakpoint` 切句，按 `-- @guard` 查 `information_schema` **跳过已存在对象**。
2. 14 个专用 apply 脚本（每个 migration 一个）：`applyDatasetRegistry.mjs` / `applyDatasetBuildConfig.mjs` / `applyDatasetWindowLayering.mts` / `applyResearchCore.mjs` / `applyResearchRunExecutionLog.mjs` / `applyResearchAnalysisTemplate.mjs` / `applyStrategyPersistence.mjs` / `applyStrategyDomainModel.mjs` / `applyStrategyDatasetBindingVersionId.mjs` / `applyResearchStrategyBridge.mjs` / `applyClosedLoopBacktestRun.mjs` / `applyResearchFinding.mjs` / `applyResearchPlanner.mjs` + 通用器。
3. **不存在「一键 up 全部」脚本**；`package.json` 只有 `db:push` 一个 db 脚本。

**🔴 项目硬规则（本任务确认仍有效）**

- ❌ 禁 `db:push` · ❌ 禁 `drizzle-kit generate` · ❌ 禁手写 `_journal.json`（属伪造）
- ✅ migration 必须显式：手写 SQL（`-- @guard:` 守卫式幂等）+ 专用 apply 脚本
- ✅ 幂等判据：apply 两次 ⇒ 第二次 `0 executed / N skipped`
- ⚠️ 若要恢复 `drizzle-kit`，**必须先重建 baseline**（journal + snapshot）

---

## 3. 表清单（60 张，按域）

### 3.1 Dataset Registry（11 张）

| 表 | schema:行 | 角色 | 实查行数 |
|---|---|---|---|
| `dataset_definition` | 1164 | 数据集定义（15 列；`datasetCode` UNIQUE；**显式存五表名**） | **1** |
| `dataset_version` | 1196 | 版本坐标 + 状态 + 计数（14 列；`uq(datasetId,version)`） | **2** |
| `dataset_build_job` | 1226 | 构建作业 checkpoint/resume | **4** |
| `dataset_build_config` | 1264 | 构建配置主表（与 version **1:1 UNIQUE**） | **2** |
| `dataset_build_config_event` | 1293 | 事件维度多值子表 | — |
| `dataset_build_config_board` | 1315 | 板块多值子表 | — |
| `ds_first_limit_pullback_event` | 1344 | **身份层**（一行 = 一 event） | **25,108** |
| `ds_first_limit_pullback_prefix` | 1381 | **L-事实**（rd ∈ [−preWindow, 0]，**含 rd=0**） | **527,268** |
| `ds_first_limit_pullback_post` | 1407 | **L-事实**（rd ∈ [1, postWindow]） | **487,692** |
| `ds_first_limit_pullback_path` | 1439 | **L-衍生**（rd ≥ 1，仅衍生量） | **487,692** |
| `ds_first_limit_pullback_outcome` | 1469 | **L-聚合**（一行 = event × horizon） | **75,324** |

**✅ 记账闭合（本次实查，逐版本精确相等）**

| 版本 | event | prefix | post | path | outcome | 五表之和 | `dataset_version.totalRows` | 闭合 |
|---|---|---|---|---|---|---|---|---|
| v1 (`390001`) | 1,130 | 23,730 | 15,876 | 15,876 | 3,390 | **60,002** | **60,002** | ✅ |
| v2 (`390002`) | 23,978 | 503,538 | 471,816 | 471,816 | 71,934 | **1,543,082** | **1,543,082** | ✅ |
| 合计 | 25,108 | 527,268 | 487,692 | 487,692 | 75,324 | **1,603,084** | **1,603,084** | ✅ **差 0** |

> 证据：`docs/evidence/_probe_baseline_ds_accounting.out.json`（按 `datasetVersionId` 分组）+ `_probe_baseline_state.out.json`（全表 COUNT）。**无孤儿行、无未记账行。**

### 3.2 Research（新，单数，15 张）

| 表 | schema:行 | 列数 | 实查行数 |
|---|---|---|---|
| `research_experiment` | 1512 | 12 | **7** |
| `research_hypothesis` | 1551 | 19 | **5** |
| `research_run` | 1606 | 13 | **18** |
| `research_analysis` | 1648 | 14 | **352** |
| `research_analysis_condition` | 1691 | 10 | **735** |
| `research_analysis_metric` | 1721 | 7 | **0** |
| `research_result` | 1746 | 9 | **6,680** |
| `research_conclusion` | 1780 | 16 | **15** |
| `research_strategy_candidate` | 1829 | 21 | **13** |
| `research_artifact` | 1931 | 9 | **0** |
| `research_analysis_template` | 1966 | 6 | — |
| `research_analysis_template_item` | 1984 | — | — |
| `research_finding` | 2109 | — | **68** |
| `research_question` | 2208 | 13 | **3** |
| `research_plan` | 2252 | 17 | **3** |

### 3.3 Research 遗留（复数，4 张）—— **LEGACY**

| 表 | schema:行 | 实查行数 | 判定 |
|---|---|---|---|
| `research_experiments` | 338 | **0** | 生产不可达 |
| `research_runs` | 363 | **2** | 生产不可达 |
| `research_experiment_batches` | 398 | **0** | 生产不可达 |
| `research_datasets` | 430 | **7** | B 体系（+2 张 `rd_rows_*` 动态表） |

### 3.4 Strategy（8 张）

| 表 | schema:行 | 角色 | 实查行数 |
|---|---|---|---|
| `strategies` | 485 | 身份 + **权威当前版本指针** `currentVersionId` | **10** |
| `strategy_versions` | 528 | **不可变版本快照**（唯一 SoT = `strategyDocumentJson`）+ 演进链 `parentVersionId` + `status` | **11** |
| `strategy_parameters` | 597 | 投影：参数定义（含 `parameterRole`） | **24** |
| `strategy_entry_rules` | 635 | 投影：Entry.conditions | **17** |
| `strategy_exit_rules` | 665 | 投影：Exit.rules | **19** |
| `strategy_execution_rules` | 697 | 投影：Execution 1:1 | **9** |
| `strategy_version_datasets` | 726 | 投影：Dataset 绑定**引用**（不复制数据） | **9** |
| `strategy_research_provenance` | 779 | 研究溯源（候选/结论/实验/Run/数据集） | **9** |

> 🔴 **Source of Truth 铁律**：`strategy_versions.strategyDocumentJson` 是唯一完整定义；5 张投影表**只能**由它派生，**禁止**反向拼装。读取路径一律经 `assertStoredVersionConsistency()`（`strategyPersistence/consistency.ts:97`）断言三方指纹一致，不一致**响亮失败**。

### 3.5 回测 / 留档（3 张）

| 表 | schema:行 | 实查行数 | 备注 |
|---|---|---|---|
| `closed_loop_backtest_run` | 2031 | **7 → 8** | 23 列；闭环唯一留档表（7 @08:40Z / 8 @08:58Z） |
| `backtest_runs` | 284 | **1** | legacy 前端回测留档（**与上表禁互灌**） |
| `paper_trading_runs` | 307 | **4** | 前向纸面交易 |

**`closed_loop_backtest_run` 实查细分（2026-09-19）**

| 维度 | 值 |
|---|---|
| 总行数 | **7（@08:40Z）→ 8（@08:58Z）** |
| `status` | `PARTIAL_BLOCKED` **8/8** |
| `datasetSource` | `registry` 4 / `rebuild` 3 |
| `datasetVersionId IS NULL` | **0**（8/8 已绑定坐标） |
| 带 BACKTEST-002 载荷（`executionPolicyVersion` 非空） | **2/8**（`clrun-20260919083211921` 与 `clrun-20260919075448567`，均 `policyVer = 1`） |
| 带 `strategyRun` 段 | **2/8** |
| 历史 6 条 | 跑在 **v0 隐式政策**下，**未回填** |

> `trades` 计数区间实测 3 ~ 208；`executedStageCount` 5~6，`blockedStageCount` 8~9（14 阶段 − 实装 8 − 部分开销）。

### 3.6 行情 / 证券主数据（11 张）

| 表 | 实查行数 | 备注 |
|---|---|---|
| `stock_daily_prices` | **8,895,704** | 未复权 raw；A 域 |
| `index_daily` | **7,492** | **交易日历唯一来源** |
| `research_securities` | **5,552** | 含退市（anti-survivorship） |
| `industry_assignments` | **5,212** | 83 行业 |
| 其余 | — | `research_security_identifier_history` / `research_security_status_history` / `corporate_actions` / `adjustment_factors` / `liquidity_daily` / `index_master` / `backfill_checkpoints` |

### 3.7 情绪 / 复盘 / 其他（9 张）

`limit_up_records` / `market_data` / `sentiment_alerts` / `stock_suspension_windows` / `stock_watchlist` / `operation_logs` / `uploaded_images` / `users`

---

## 4. 表 ↔ 代码对象映射（核心四处）

| DB 表 | 代码对象 | 映射方式 | 关键纪律 |
|---|---|---|---|
| `dataset_version` | `DatasetVersion`（`datasetRegistry/types.ts:39`） | `DbDatasetRegistry`（`db.ts:243`） | `totalRows` = 五表行数之和 |
| `strategy_versions` | `StrategyVersionRecord`（`strategySchema/types.ts`） | `DbStrategyRepository`（`strategyPersistence/db.ts`） | 唯一允许 UPDATE 的列 = `status` |
| `closed_loop_backtest_run` | `ClosedLoopBacktestRun`（`closedLoopBacktestRun/repository.ts`） | `saveClosedLoopBacktestRun`（`:79`） | `runId` 唯一键保证幂等；列表**不读** `resultJson` |
| `research_*`（10 单数） | `ResearchRepositories`（`researchCore/repository/contract.ts:443`） | `createDbResearchRepositories()`（`db.ts:532`） | `researchCore` 边界由测试固化 |

---

## 5. 关系图（逻辑，非物理 —— **全库 0 FK**）

```text
dataset_definition ─(软引用)─ dataset_version ─┬─(软引用)─ research_experiment.datasetVersionId
   └ dataset_build_config (1:1)                ├─(软引用)─ strategy_versions.datasetVersionId
   └ ds_* 五表 (datasetVersionId 列)            ├─(软引用)─ strategy_version_datasets.datasetVersionId
                                               ├─(软引用)─ research_strategy_candidate.sourceDatasetVersionId
                                               └─(软引用)─ closed_loop_backtest_run.datasetVersionId

research_experiment ─┬─ research_hypothesis (experimentId, runId)
                     └─ research_run (experimentId)
                          └─ research_analysis (runId) ─┬─ research_analysis_condition (analysisId)
                                                        ├─ research_analysis_metric (analysisId)
                                                        └─ research_result (analysisId, metricCode)
research_conclusion ── research_strategy_candidate (conclusionId)
                          └─(转正)─ strategies / strategy_versions ─┬─ 5 投影表 (strategyId, version)
                                                                    └─ strategy_research_provenance
strategy_versions ──(闭环运行)─ closed_loop_backtest_run (strategyId, strategyVersion)
```

**软引用代表列（8 例）**：`dataset_version.datasetId`（schema:1198）· `strategy_versions.strategyId`（:531）· `strategy_versions.parentVersionId`（:555，自引用）· `strategy_versions.datasetVersionId`（:542）· `closed_loop_backtest_run.strategyId/datasetVersionId`（:2037-2046）· `research_strategy_candidate.sourceDatasetVersionId`（:1854）· `research_hypothesis.experimentId/runId`（:1553）· `research_run.experimentId`（:1608）

**⚠️ 无 FK 的直接后果（已登记）**：`datasetBindingValidation` 承认存在「校验通过 → 提交前被删」的窗口（`strategyPersistence/datasetBindingValidation.ts:15-16`、`db.ts:257-258`）⇒ 引用完整性靠**应用层 + 校验时机**，不靠 DB。

---

## 6. 历史 Run 保护规则（FACT，本任务确认）

| 规则 | 依据 |
|---|---|
| 历史 Run **不回填** | 6 条 v0 政策留档保持原样（R-05） |
| `resultJson` 新增段必须**可选** | `backtestRunPayloadSchema` 中 `backtest` 为可选 ⇒ 历史留档不受影响 |
| 留档写入 **best-effort 不抛** + 有界重试 ≤3 | `researchRunRouter.ts:272-316` |
| 列表查询**不读** `resultJson` | `closedLoopBacktestRun/repository.ts:148-163` `SUMMARY_COLUMNS` |
| `closed_loop_backtest_run` 与 `backtest_runs` **禁互灌** | `drizzle/0037_closed_loop_backtest_run.sql:8-10` |
| 不修改历史数据而不登记 | 项目规则；本任务**零写入**（除探针只读） |

---

## 7. DATABASE-MAP 上的 OBSERVED

| # | 现象 | 证据 | 影响 |
|---|---|---|---|
| D-1 | drizzle 发布链路自 0024 停摆（journal 止 0023 / snapshot 止 0015 / `__drizzle_migrations` 24 行） | 实读三处 | `db:push` 不可用；恢复需重建 baseline |
| D-2 | 全库 **0 外键** | grep 实证 | 引用完整性靠应用层；存在校验-提交窗口 |
| D-3 | `prefix`/`post` 物理表**不在 drizzle migration 链内**（由插件声明式 DDL + `applyDatasetWindowLayering.mts` 重建） | `0030` 注释 `:12-14` 自认 | **迁移链与 DDL 双源漂移**风险 |
| D-4 | `research_analysis_metric` / `research_artifact` **0 行** | 实查 | 有表无数据（非缺陷，登记为现状） |
| D-5 | 遗留复数表仍在库（`research_runs` 2 行、`research_datasets` 7 行 + 2 张 `rd_rows_*`） | 实查 | 认知混淆；**未来清理应优先重命名遗留表**（与单数表仅差一个 `s`） |
| D-6 | 闭环 **8/8** 全 `PARTIAL_BLOCKED` | 实查 | 与「14 阶段实装 8」一致，属如实登记而非失败 |
| D-7 | `strategy_versions.codeVersion` **11/11 = `1.0.0+gunknown`** | 实查 | 版本列存在但**不可复现** |

---

## D-90 PARAMETER-001 增量：新增 3 张留档表（2026-09-19 · `9bs`）

| 表 | 列数 | 角色 | 索引 |
|---|---|---|---|
| `parameter_search_run` | 26 | 搜索运行头（身份 / 参数空间快照 / FIXED 坐标 / 计数 / 状态 / 时间戳） | `uq_parameter_search_run_id (searchRunId)` UNIQUE · `idx_..._created` · `idx_..._strategy (strategyId, createdAt)` · `idx_..._status` |
| `parameter_search_combination` | 10 | 组合计划层（笛卡尔积成员 + 执行状态；Resume / Retry 的判据） | `uq_..._combination_hash (searchRunId, parameterHash)` UNIQUE · `idx_..._run` · `idx_..._status` |
| `parameter_search_result` | 23 | 单组合产物（六指标读数 + 可追溯引用 + 失败原因） | `uq_..._result_hash (searchRunId, parameterHash)` UNIQUE · `idx_..._run` · `idx_..._status` |

**约束遵守（与 §1 / §5 / §6 一致）**：
- **零 FK**：三表 0 个外键；全库 FK 总数仍为 **0**（apply 脚本断言）。
- **软引用**：`strategyId` / `strategyVersion` / `datasetVersionId` / `backtestRunId` 全为快照值 + 应用层保证。
- **无回填 / 无数据迁移**：新表从 0 行开始；既有 14 张表的列签名与行数在 apply 前后**逐表一致**（脚本断言）。
- **幂等**：手写 SQL `drizzle/0041_parameter_search.sql`（`-- @guard: table ...`）+ `scripts/applyParameterSearch.mjs`；
  第二次运行 **0 executed / 3 skipped**、`pass=true`。
- **禁 `db:push` / `drizzle-kit generate`**：`drizzle/meta/_journal.json` 仍止于 0023，未改动。
- 🔴 **不改历史**：`parameter_search_run.parameterSpaceJson`（参数空间快照）**写入即冻结** —— `ON DUPLICATE KEY UPDATE` 集合中**不含**它，
  未来策略版本修改后历史 Run 的搜索空间**不会被重新解释**。
- 三表**不参与任何执行路径**：清空它们不影响回测正确性，只影响「能不能回看 / 续跑」。
