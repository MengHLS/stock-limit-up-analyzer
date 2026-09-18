# `docs/evidence/` —— 根目录证据簇（2026-09-13 归位）

> **这是什么**：原本散落在仓库根目录的 `_*` 探针脚本与运行结果，共 **85 个文件**，于 2026-09-13 整体迁入本目录。

> **为什么归位**：`PROJECT_RULES.md:73` 明确根目录 `_*` 探针「可安全留存作证据」，但 96 个裸文件堆在根目录会掩盖真实源码结构（项目自己的审计报告 `docs/audit/reports/2026-09-09_AUDIT-002_*.md` 的 C-2 条目即为此立项）。归位后根目录文件数 131 → 20。

> **为什么放在 `docs/` 下**：`tsconfig.json` 的 `include` 只覆盖 `client/src/**`、`shared/**`、`server/**`，`vitest.config.ts` 的 `include` 同理 ⇒ `docs/evidence/**` **不进编译、不进测试**，与原来的根目录待遇一致，而相对 import 已从 `./server/…` 修正为 `../../server/…`。


## 路径约定（🔴 历史文档的读写判据）

**2026-09-13 之前的文档/日志里出现的裸文件名（如 `_r007_probe_result.md`），一律指向本目录下的同名文件。**

原因是 `PROJECT_RULES.md:129` 有明文「**历史条目零改写**」⇒ `ROADMAP-CHANGELOG.md` 与 `.workbuddy/memory/**` 里的历史提及**一个字符都没改**，只在本文件与该日日志里登记了这条映射。


## 如何重跑这些探针

```bash
# 必须在项目根目录执行（脚本按 CWD 写输出、按 ../../ 找源码）
npx tsx docs/evidence/_r007_run_engine.mts
```

⚠️ 探针依赖真实 TiDB：跑 `getDb()` 的脚本会拖住 event loop，须以 `process.exit()` 显式收尾；研究 Run 在途时**禁跑**（见 `PROJECT_RULES.md:36`）。


## 文件索引


### `r006` —— 2 个

| 文件 | 被引用于 |
|---|---|
| `_r006_probe.mjs` | `ROADMAP.md`、`docs/research/RESEARCH-006.0-architecture.md` |
| `_r006_probe_result.md` | `ROADMAP.md`、`docs/research/RESEARCH-006.0-architecture.md` |

### `r0061` —— 8 个

| 文件 | 被引用于 |
|---|---|
| `_r0061_apply.json` | `ROADMAP.md`、`docs/research/RESEARCH-006.1-implementation.md` |
| `_r0061_apply2.json` | `ROADMAP.md`、`docs/research/RESEARCH-006.1-implementation.md` |
| `_r0061_check.json` | `ROADMAP.md`、`docs/research/RESEARCH-006.1-implementation.md` |
| `_r0061_fulltest.clean.log` | `docs/research/RESEARCH-006.1-implementation.md` |
| `_r0061_fulltest.log` | `ROADMAP.md`、`docs/research/RESEARCH-006.1-implementation.md` |
| `_r0061_probe.mjs` | `docs/research/RESEARCH-006.1-implementation.md` |
| `_r0061_probe_result.md` | `ROADMAP.md`、`docs/research/RESEARCH-006.1-implementation.md` |
| `_r0061_verify.log` | `ROADMAP.md`、`docs/research/RESEARCH-006.1-implementation.md` |

### `r0062` —— 5 个

| 文件 | 被引用于 |
|---|---|
| `_r0062_fulltest.clean.log` | `docs/research/RESEARCH-006.2-implementation.md` |
| `_r0062_fulltest.log` | `ROADMAP.md`、`docs/research/RESEARCH-006.2-implementation.md` |
| `_r0062_probe.mjs` | `docs/research/RESEARCH-006.2-implementation.md` |
| `_r0062_probe_result.md` | `ROADMAP.md`、`docs/research/RESEARCH-006.2-implementation.md` |
| `_r0062_verify.log` | `ROADMAP.md`、`docs/research/RESEARCH-006.2-implementation.md` |

### `r0063` —— 4 个

| 文件 | 被引用于 |
|---|---|
| `_r0063_bridge_tests.log` | `ROADMAP.md`、`docs/research/RESEARCH-006.3-implementation.md` |
| `_r0063_fulltest.log` | `ROADMAP.md`、`docs/research/RESEARCH-006.3-implementation.md` |
| `_r0063_tsc.log` | `ROADMAP.md`、`docs/research/RESEARCH-006.3-implementation.md` |
| `_r0063_verify.log` | `ROADMAP.md`、`docs/research/RESEARCH-006.3-implementation.md` |

### `r00641` —— 4 个

| 文件 | 被引用于 |
|---|---|
| `_r00641_build.log` | `docs/research/RESEARCH-006.4.1-A-implementation.md` |
| `_r00641_fulltest.log` | `docs/research/RESEARCH-006.4.1-A-implementation.md` |
| `_r00641_tsc.log` | `docs/research/RESEARCH-006.4.1-A-implementation.md` |
| `_r00641_verify.log` | — |

### `r00641b` —— 6 个

| 文件 | 被引用于 |
|---|---|
| `_r00641b_focused_tests.log` | `docs/research/RESEARCH-006.4.1-B-implementation.md` |
| `_r00641b_fulltest.log` | `docs/research/RESEARCH-006.4.1-B-implementation.md` |
| `_r00641b_tsc.log` | `docs/research/RESEARCH-006.4.1-B-implementation.md` |
| `_r00641b_verify_pass.log` | `docs/research/RESEARCH-006.4.1-B-implementation.md` |
| `_r00641b_verify_run2_econnreset.log` | `docs/research/RESEARCH-006.4.1-B-implementation.md` |
| `_r00641b_vitebuild.log` | `docs/research/RESEARCH-006.4.1-B-implementation.md` |

### `r007` —— 18 个

| 文件 | 被引用于 |
|---|---|
| `_r007_audit_probe.mjs` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_audit_probe2.mjs` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_audit_probe2_result.md` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_audit_probe3.mjs` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_audit_probe3_result.md` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_audit_probe_result.md` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_batch_plan.md` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_build_run.mts` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_catalog.md` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_catalog_probe.mts` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_conclusion.md` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_conclusion.mts` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_probe.mjs` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_probe_result.md` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_run_engine.mts` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_run_result.md` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_summarize.mts` | `docs/research/RESEARCH-010-implementation.md` |
| `_r007_summary.md` | `docs/research/RESEARCH-010-implementation.md` |

### `r0071` —— 10 个

| 文件 | 被引用于 |
|---|---|
| `_r0071_apply.mts` | `docs/research/RESEARCH-007.1-pullback-correction.md` |
| `_r0071_batch_plan.md` | `ROADMAP.md`、`docs/research/RESEARCH-007.1-pullback-correction.md`、`docs/research/RESEARCH-007.3-run-540001-coverage-backfill.md` |
| `_r0071_fix.md` | `docs/research/RESEARCH-007.1-pullback-correction.md` |
| `_r0071_fix.mts` | `docs/research/RESEARCH-007.1-pullback-correction.md` |
| `_r0071_offline.mjs` | `docs/research/RESEARCH-007.1-pullback-correction.md` |
| `_r0071_offline_mtd.md` | `docs/research/RESEARCH-007.1-pullback-correction.md` |
| `_r0071_run_engine.mts` | `docs/research/RESEARCH-007.1-pullback-correction.md` |
| `_r0071_run_result.md` | `docs/research/RESEARCH-007.1-pullback-correction.md` |
| `_r0071_summarize.mts` | `docs/research/RESEARCH-007.1-pullback-correction.md` |
| `_r0071_summary.md` | `ROADMAP.md`、`docs/research/RESEARCH-007.1-pullback-correction.md`、`docs/research/RESEARCH-007.2-research-matrix-view.md` 等 4 处 |

### `r008` —— 3 个

| 文件 | 被引用于 |
|---|---|
| `_r008_matrix_probe.mts` | `ROADMAP.md`、`docs/research/RESEARCH-007.2-research-matrix-view.md`、`docs/research/RESEARCH-007.3-run-540001-coverage-backfill.md` |
| `_r008_matrix_probe_result.md` | `ROADMAP.md`、`docs/research/RESEARCH-007.2-research-matrix-view.md`、`docs/research/RESEARCH-007.3-run-540001-coverage-backfill.md` |
| `_r008_matrix_probe_result_135.md` | `docs/research/RESEARCH-007.3-run-540001-coverage-backfill.md` |

### `r009` —— 3 个

| 文件 | 被引用于 |
|---|---|
| `_r009_coverage_probe.mts` | `ROADMAP.md`、`docs/research/RESEARCH-007.3-run-540001-coverage-backfill.md` |
| `_r009_coverage_probe_result.md` | `ROADMAP.md`、`docs/research/RESEARCH-007.3-run-540001-coverage-backfill.md` |
| `_r009_coverage_probe_result_135.md` | `docs/research/RESEARCH-007.3-run-540001-coverage-backfill.md` |

### `r010` —— 4 个

| 文件 | 被引用于 |
|---|---|
| `_r010_backfill_apply.mts` | `ROADMAP.md`、`docs/research/RESEARCH-007.3-run-540001-coverage-backfill.md` |
| `_r010_backfill_plan.md` | `docs/research/RESEARCH-007.3-run-540001-coverage-backfill.md` |
| `_r010_backfill_run.mts` | `ROADMAP.md`、`docs/research/RESEARCH-007.3-run-540001-coverage-backfill.md` |
| `_r010_backfill_run_result.md` | `docs/research/RESEARCH-007.3-run-540001-coverage-backfill.md` |

### `pool` —— 2 个

> 连接池死连接治理证据簇（2026-09-13：`Failed query: … U read ECONNRESET`）。
> 生产代码坐标：`server/db.ts`（`maxIdle` / `resolveIdleTimeoutMs` / `withReadRetry` 接线）。

| 文件 | 用途 |
|---|---|
| `_probe_pool_stale.mts` / `.json` | 证明「SQL 本身没问题」（两次均成功 / 5,337 行）⇒ 报错来自连接层 |
| `_probe_pool_fix_verify.mts` / `.json` | 修复验证：回收定时器可启动 + `getLeaderCandidates()` 真跑通 + 瞬时错误重试恢复 + 语义错误不误重试 |

### `runworkbench` —— 12 个

> 运行工作台「真实跑通」证据簇（`useRealData=true`：真实构数据集 → 真实读策略文档 → 按配方装配阶段入参）。
> 生产代码坐标：`server/runWorkbenchAssembly/**`、`server/research/recipeRegistry.ts`、`server/research/closedLoopWiring/executors.ts`。

| 文件 | 用途 |
|---|---|
| `_probe_realdata_assembly.mts` / `.json` | 列真实策略与版本（发现 `hasRecipe=false`，配方需注册表兜底） |
| `_probe_strategy_doc_shape.mts` / `.json` | 检查 3 份策略文档的 costModel / executionModel / recipe 形态 |
| `_probe_realdata_e2e.mts` / `.json` | **核心取证**：真实 tRPC caller 走 `loopRun({useRealData:true})` → 5 阶段 EXECUTED |
| `_probe_regime_subset.mts` / `.json` | 子集链验证：证明 regime 受 canonical 前驱未装配所限 |
| `_probe_regime_executor.mts` / `.json` | regime 执行器本体单独验证（7 项断言全过） |
| `_probe_inflight_check2.mts` / `_probe_inflight_runs.json` | 改 server 前的在途 Run 安全检查（零在途） |

### `diag` —— 5 个

| 文件 | 被引用于 |
|---|---|
| `_diag_cand_count.mts` | — |
| `_diag_cand_sketch.mts` | — |
| `_diag_dsv_read.mts` | — |
| `_diag_pool_state.mts` | — |
| `_diag_wb_view.mts` | — |

### `e2e` —— 3 个

| 文件 | 被引用于 |
|---|---|
| `_e2e_first_board_pullback.mts` | `ROADMAP.md` |
| `_e2e_sketch_form.mts` | `ROADMAP.md` |
| `_e2e_sketch_roundtrip.mts` | `ROADMAP.md` |

### `misc` —— 10 个

| 文件 | 被引用于 |
|---|---|
| `_create_analyses.log` | — |
| `_dupcheck_probe.mjs` | `ROADMAP.md`、`docs/step-dataset-003b-report.md` |
| `_limitprecision_probe.mjs` | `ROADMAP.md`、`docs/step-dataset-003b-report.md` |
| `_perf_probe.mts` | — |
| `_perflog.txt` | — |
| `_probe_when_gap.mts` | `ROADMAP.md` |
| `_s003_verify.log` | `docs/strategy/STRATEGY-003-report.md` |
| `_t1anchor_probe.mjs` | `docs/step-dataset-003b-report.md` |
| `_vite_build_c41c.log` | — |
| `_vite_build_whengap.log` | `ROADMAP.md` |

### `perf` —— 7 个（2026-09-13 运行工作台「等很久」专项）

| 文件 | 结论要点 | 被引用于 |
|---|---|---|
| `_probe_liquidity_scale.mts` | `liquidity_daily` = 901.5 万行；唯一键 `(securityCode, tradeDate)`；单条 400 只查询 ≈ 250ms（`Batch_Point_Get`）⇒ **SQL 无罪** | `ROADMAP.md` |
| `_probe_run_timing.mts` | 单月涨停候选 4.1s（11,377 行）；三月 23.1s（29,247 行）；`loadTradingDays` 382ms | — |
| `_probe_bandwidth.mts` | 🔴 **首轮单次采样得出「并发惩罚 3.45×」，后被证伪**（见 `_probe_concurrency_interleaved.mts`）；`compress` 净收益 2.57× | `ROADMAP.md`（记录教训） |
| `_probe_singleconn.mts` | `compress=true` 3130ms vs `false` 8039ms（2.57×）；1 连接 vs 4 连接 = 3143 vs 3782ms | — |
| `_probe_concurrency_penalty.mts` | 三轮中位：c=1/2/4 = 2011/1369/1940ms ⇒ 惩罚 0.96×（**推翻**前结论） | — |
| `_probe_concurrency_interleaved.mts` | 🔴 **权威结论**：交错 5 轮，c=1/2/4 = 1406/1268/1355ms ⇒ **并发无惩罚（0.96×）**。单次采样不可信 | `ROADMAP.md` |
| `_probe_build_cost.mts` | 390002 窗口 = 484 交易日 / 5,604 标的 / 23,978 事件；涨停候选均值 **5,615ms per 30 日 × 23 片 ≈ 129s**；Phase2 定向取数 400 只 × 30 日 ≈ 5.7s | `ROADMAP.md` |

### `datasetdirect` —— 7 个（2026-09-13 运行工作台「数据集被无视」专项修复）

> **背景**：用户质疑「我明明设置了数据集，为什么还要去日线行情表查」。实查证实指控成立 ——
> `assemble.ts` 无条件从零重建，无视策略已绑定的 `datasetVersionId=390002`，也无视 `ds_*` 里
> 已落库的 1,543,082 行。修复 = 新增「优先直读已绑定数据集」桥
> （生产代码：`server/runWorkbenchAssembly/datasetFromRegistry.ts`）。

| 文件 | 结论要点 | 被引用于 |
|---|---|---|
| `_probe_ds_rows.mts`（在 `perf` 节亦有登记） | 🔴 **决定性证据**：`ds_*` 五表按 390002 计数 = 23,978 + 503,538 + 471,816 + 471,816 + 71,934 = **1,543,082**（与 `dataset_version.totalRows` 逐字一致）；`prefix` 样本证明含 OHLCV | `ROADMAP.md` |
| `_probe_strategy_dataset_binding.mts`（在 `perf` 节亦有登记） | 🔴 **绑定确认**：3 份策略文档全部含 `datasetVersionId: 390002`（PRIMARY） | `ROADMAP.md` |
| `_probe_registry_direct_e2e.mts` | **桥本体验证**：390002 直读 → 23,978 行 / 484 日 / `bindResearchDataset` 全部不变量通过 / 事件计数与真实库逐字一致 ✅。**耗时 40.8s → 7.9s**（并发优化后） | `ROADMAP.md` |
| `_probe_registry_direct_breakdown.mts` | **耗时拆分**：事件分页 limit=5000 最优（5.3s）；rd=0 批读 batch=1000/conc=16 最优（1.4s）⇒ 最优组合 ≈ 6.7s | `ROADMAP.md` |
| `_probe_runworkbench_dataset_source.mts` | **装配层三路径验证**（真实 DB）：A 带绑定 id → `registry` / **6.2s** / 23,978 行；B 无绑定 → `rebuild` / 60.6s / 96,912 行 + 原因如实；C 不存在 id → `rebuild` + `REGISTRY_VERSION_NOT_FOUND`（不静默）⇒ **直读比重建快 ~10×** | `ROADMAP.md` |
| `_probe_post_coverage.mts` | 🔴 **回答「T+N 撮合是否要重新设计数据集表」**：`prefix` rd∈[-20,0] / 503,538 行 / **rd=0 上 (tradeDate,symbol) 严格唯一（0 冲突）**；`post` rd∈[1,20] / 471,816 行 / **在 (tradeDate,symbol) 上有 95,977 组冲突、单日最多 8 行** ⇒ `post` 不是逐日面板、不能直接并入 `rows`（会破唯一键）；23,978 事件中 23,107 个覆盖满 20 日、871 个不足（窗口末端）；`outcome` horizon = {5,10,20}；event 覆盖 484 日 | 本轮回答（`ROADMAP.md` / 记忆） |
| `_probe_observe5_buy.mts` | 🔴 **回答「T日首板 → 观察5日 → 满足条件买入」能否表达**：`resolveSignalTimeline` 四个 trigger 的 `earliestSignalOffset`（`FIRST_VALID_DAY`/`EVERY_VALID_DAY`=T+1、`NEXT_TRADING_DAY`=T+2、`LAST_VALID_DAY`=T+5）；`CALENDAR_DAY` ⇒ `resolvable=false`（前视引用一律拒）；字段引用形态（`bar.*`=`currentBar` / `prefix.rd*`=`preEvent` / `post.rd*`=`forwardBar` / `path.*`&`outcome.*`=`labelOnly`）；**`post.rd6` 被 `INVALID_FUTURE_REFERENCE` 拒绝、`post.rd1` 放行** ⇒ 证明「观察5日内满足条件」用 `bar.*` + `condition` 表达、**不需要 `post`** | 本轮回答（`ROADMAP.md` / 记忆） |
| `_probe_research_to_condition.mts` | 🔴 **回答「条件应由研究实验测算出来」的链路缺口**：研究侧 **12 种**分析类型（非 5 种）；`CONDITIONAL` 的输入即「结构化条件集」、输出为「条件样本 vs 全样本」的均值/中位/胜率/回撤 + Welch t/p；🔴 **但** 研究侧条件字段名（`FEATURE_VARIABLES`/`OUTCOME_VARIABLES`，如 `pre_return_5d`）与策略侧字段引用（`bar.*`/`prefix.rdN.*`/`post.rdN.*`）**是两套不同源的词表**，中间缺一层翻译；结论 `evidence` 输出的是**统计判定**（`alpha`/`materialityAbs`/`minSampleCount`/`stabilityMinConsistentRatio`），**不是可直接转成策略条件的表达式** | 本轮回答 |
| `_probe_gap_analysis.mts` | 🔴 **决定性：把 3 处缺口钉死在代码坐标**（方案文档 `docs/research/PLAN-research-to-strategy-condition.md` 的证据底座）：① 声明 **12 种**分析 / **实际注册仅 6 种**（`descriptive`/`eventStudy`/`quantile`/`conditional`/`stability`/`segmentRelation`），**未实现 = `DISTRIBUTION`/`CORRELATION`/`IC`/`PATH`/`REGIME`/`SIGNIFICANCE`**（`analyses/registry.ts:60-65`）；② `FEATURE_VARIABLES` 共 **17 个，全部只读 `event` + `prefix`（≤ T）**；③ 🔴 **观察日（T+1..T+5 中间某一天）的「当日 bar 属性」变量数 = 0** ⇒ 「观察日缩量 / 观察日回踩」这类条件**今天测不出来**（不是不好用，是测不了） | `PLAN-research-to-strategy-condition.md` + 本轮回答 |

---

### `strategyspec` —— 2 个（2026-09-13 18:06 用户完整策略规格「首板回踩 · 量价时三维过滤」落地）

> **背景**：用户给出完整策略规格（首板质量 / 回调形态 / 时间窗口 / 买卖点与风控 / 误区）。
> 目标 = 逐条翻译为策略字段引用，并实查**每条今天能否表达**（不凭感觉说「可以」）。
> 结论文档：`docs/research/STRATEGY-SPEC-first-limit-pullback.md`。

| 文件 | 结论要点 | 被引用于 |
|---|---|---|
| `_probe_condition_mapping.mts` | 🔴 **决定性：用户策略可完整表达并通过定义校验器** —— `validateCanonicalStrategyDefinition` 返回 **`valid = true, issues = 0`**（6 条入场条件 + 硬止损 + 时间止损）。逐条解析：`event.daysSincePreviousLimit`/`event.isFirstLimit` = `eventDay`；`prefix.rd0.*` = `preEvent rd=0`；`bar.*` = `currentBar`；`resolveSignalTimeline(FIRST_VALID_DAY, {1,5})` ⇒ `earliestSignalOffset=1` / `resolvable=true`。⚠️ **首跑 5 条 issue 全是探针写错枚举**（`schemaVersion` 正确为 `"1.0"`；`signalTiming` = `T_OPEN\|T_CLOSE`；`executionTiming` = `T_CLOSE\|T_PLUS_1_OPEN\|…`；`quantityMethod` = `FIXED_SHARES\|TARGET_WEIGHT\|AMOUNT`；`STOP_LOSS` 需 `threshold`）—— **策略条件本身零 issue** | `STRATEGY-SPEC-first-limit-pullback.md` + 本轮回答 |
| `_probe_semantic_gaps.mts` | 🔴 **量化 3 处语义偏差**（校验器只查结构、不查语义）：**G1**「回调期间最低价」= 累积约束 `min(low[T+1..T+k])`，逐日条件 `bar.low>=prefix.rd0.low` 只是近似 —— 实测差 **T+1=0 / T+2=201 / T+3=630 / T+4=993 / T+5=1,393**（逐日 76.0% vs 累积 70.2%，**高估 5.8%**）；**G2** 前5日均量需 rd=-5..-1 聚合、**单一字段引用表达不了**（但 **23,978/23,978 事件前5日 prefix 完整**）；**G3** 「反包前一日」需窗口内相对引用 `T+k-1`、**框架无此能力**；另实查 `close=high`（实体涨停）= 23,907/23,978（99.7%）、一字板 706、`marketCap`/`floatMarketCap` **100% NULL**、`industryCode` 空 99.5% | `STRATEGY-SPEC-first-limit-pullback.md` + 本轮回答 |


---

### `backtestpersist` —— 5 组（2026-09-13 闭环回测「零成交」根因修复 + 2026-09-14「每次回测自动留档」）

> **背景**：用户先报「运行策略后前端没有任何东西产生」（2026-09-13），修复后又报
> 「每次回测的结果应该保存，并有地方可以展示」（2026-09-14）。两轮指向同一件事：
> **闭环 `loopRun` 此前是无状态调用，跑完即弃** —— 结果既不展示、也不落库。

| 文件 | 结论要点 | 被引用于 |
|---|---|---|
| `_probe_backtest_zero_trades.mts` | 🔴 **「0 成交」根因取证（改动前）**：registry 直读 23,978 行 ⇒ **59/59 单全 `SUSPENDED`、0 成交、权益曲线恒 100,000**；同一策略同窗口强制 rebuild ⇒ **133 笔成交 / 期末 112,169.43（+12.17%）**；「执行日有没有行」逐单核对：registry 意图 60 → 有行 **0**、rebuild 意图 255 → 有行 **250** | `ROADMAP.md` §44 |
| `_probe_after_fix_backtest_output.mts` + `.json` | ✅ **修复后真实 tRPC 复验（6/6 PASS，8m21s）**：`datasetSource=rebuild` / **292,489 行** / `tradeCount=133` / `finalEquity=112169.43` / 曲线 57 点中 **54 个不同取值（非平）** / `byReason={INSUFFICIENT_CASH:6}`（**零 `SUSPENDED`**） | `ROADMAP.md` §44 |
| `_probe_backtest_storage_state.mts` + `.json` | 🔴 **留档现状取证**：legacy `backtest_runs` 真实库**存在但仅 1 行**（2026-09-04 16:27，单条 `resultJson` **5,610,196 字符 ≈ 5.6MB**）；`research_run` 实查 13 列（`executionLogJson` 是**批次日志**、非结果）⇒ 证明闭环结果**无处可落** | 本轮 `ROADMAP.md` §44 |
| `_probe_closed_loop_persist_e2e.mts` + `.json` | ✅ **留档端到端（真实 tRPC + 真库）**：跑一次 ⇒ 留档 **+1 行**；列表摘要**逐字段等于**运行结果（9 项比对）；详情含完整 `stages`（14 阶段）与权益曲线/成交明细；**列表不携带长文本结果**；同 `runId` 写两次**仍只有一行**（幂等收敛），且探针自清理不留污染 | 本轮 `ROADMAP.md` §44 |
| `_probe_clbr_rows.mts` | 🔧 **留档行巡检 / 残留清理**（默认**只读**）：列出每行坐标 + 状态 + 成交 + `resultJson` 字符数，用于判断产品页是否有探针残留。⚠️ 加 `--clean-probe-rows` 时按**双重命名守卫**（`experimentId LIKE 'EXP-PROBE%'` **且** `strategyId LIKE 'probe-%'`）删除，并额外列出「**只命中单侧守卫**」的可疑行**不自动删**（防止守卫放宽后误删真实运行）。已清掉首跑崩溃留下的 1 行幂等残留（`EXP-PROBE-IDEM` / `resultJson` 仅 451 字符）⇒ 现留档 **2 行全为真实运行**（`cand-360001@1.0.0`，39,808 字符） | 本轮 `ROADMAP.md` §44 + `ROADMAP-CHANGELOG.md` |

### `seclabels` —— 5 个（2026-09-14 成交明细「证券名称 + 代码」）

> 触发 = 用户「**成交明细我需要展示股票的名称及代码**」（2026-09-14）。
> 核心事实：闭环结果 `trades[].securityId` 是 `sec_<uuid>`（**不是**代码），而真实库
> **没有证券名称主数据表** ⇒ 必须两步解析（`identifier_history` → `limit_up_records`）。

| 文件 | 结论要点 | 被引用于 |
|---|---|---|
| `_probe_symbol_name_source.mts` + `.log` | 🔴 **键形状取证**：`trades[].securityId` 实测为 **`sec_<uuid>`**（3 次留档共 **388** 笔 / **251** 个唯一值），与 `limit_up_records.stockCode`（`603439.SH` 形式）**匹配率 0** ⇒ 直接印在表格里毫无可读性；`Trade` 字段并集 = 11 个、**不含任何名称类字段**；`limit_up_records` = **99,617** 行 / **4,324** 个 distinct code | 本轮 `ROADMAP.md` §44 |
| `_probe_symbol_identity_bridge.mts` + `.log` | ✅ **身份桥可用性**：`research_securities` **5,552** 行、`research_security_identifier_history` **5,552** 行（`distinctIds == distinctCodes` ⇒ **无 code reuse**）⇒ `sec_<uuid>` → 代码 **251/251 全覆盖**；经名称源后 **158/251** 能取到名称 | 同上 |
| `_probe_name_tables.mts` + `.log` | 🔴 **名称源穷举**：真实库 **60 张表**中，含 name 的列共 **26** 个，其中**只有** `limit_up_records.stockName` 承载股票名称（`stock_watchlist.stockName` 仅 6 行）；**确认不存在证券名称主数据表** | 同上 |
| `_probe_name_gap_diagnosis.mts` + `.log` | 🔴 **缺口根因**：93 个缺名称的代码去 `limit_up_records` 精确查 **0 命中** ⇒ **收录口径问题、非键匹配 bug**；缺口集中在**创业板 300/301（74/152）与科创板 688（19/35）**，而沪主板 **0/30**、深主板 **0/34** 全有 | 同上 |
| `_probe_security_labels_e2e.mts` + `.json` + `.log` | ✅ **端到端（真实 tRPC + 真库）· 0 失败 PASS**：端点返回 251 条与入参去重数一致；**251/251** 译成 canonical 代码、**格式/交易所冲突 0**；名称覆盖 **158/251 = 62.9%**（缺口 93，且缺口内**非法代码 0** ⇒ 是收录问题）；空数组与 **501** 个 id **实测被 zod 拒**；端点与仓储直调**逐条零差异** | 同上 |

### `runrestore` —— 3 个（2026-09-14 「运行结果刷新即丢」诊断 + 展示层修复）

> 触发 = 用户「**我刚才跑过的回测，结果又没了，是什么问题**」（2026-09-14）。
> 核心事实：**数据没丢**（留档 `id=60001` 完整在库），丢的是**展示层**（结果只存 `useState`，而 `dev` 是单进程 `tsx watch` ⇒ 整页重载即丢）。

| 文件 | 结论要点 | 被引用于 |
|---|---|---|
| `_probe_run_tab_hydration.mts` + `.json` | ✅ **刷新恢复路径（真实 tRPC + 真库）· 0 失败 PASS**：`listBacktests({strategyId,limit:1})` 按策略命中且**倒序**；**列表行不带 `result`**；详情摘要与列表**逐字段一致**；`buildClosedLoopRunViewModel`（**前端同一函数**）构建成功 ⇒ `stages=14`、`trades=208/208`、曲线 57 点；首笔 `sec_314d87cf-…` → **欣天科技 300615.SZ**；同时实查 `closed_loop_backtest_run#id=60001`（`cand-270001@1.0.0`、208 笔、期末 96,481.05）证明「数据没丢」 | 本轮 `ROADMAP.md` §44 |
| `tests/client/src/pages/strategyRunResultPersist.test.ts`（**不在本目录**，登记于此便于溯源） | ✅ **7/7 通过**：静态扫真实源码 + 真实 `appRouter` 端点断言，钉住「留档恢复存在 / 按策略取最近一次 / **本次结果优先**（分支顺序）/ 复用同一套 VM + 面板 / 空态**禁**谎称「还没跑过」/ `resultJson` 为空必须明说 / 跑完 `invalidate`」 | 同上 |
| `_dev_boot_check.log` | 🔴 **端口取证**：实测 `Port 3000 is busy, using port 3101 instead` ⇒ 3000 落在 Windows 保留段 `2980–3079`（`node` 直接 `listen(3000)` = **`EACCES`**、**非** `EADDRINUSE`；`netstat` **看不到**占用者）⇒ **必须按启动日志打印的端口访问** | 同上 |

### `datasetscope` —— 4 组（2026-09-14：数据集范围继承 + 成交代码译码正确性）

| 文件 | 结论 | 引用于 |
|---|---|---|
| `_probe_dataset_scope_inherit_e2e.mts` + `.json` | ✅ **PASS / 0 失败（真实 tRPC `loopRun`，112,525ms）**：证券池 **5146 → 3180**（主板）；`datasetSourceNote` 含「已继承该数据集的 universe 约束：板块=main、排除 ST/*ST（来源=build-config）」；成交 **185 笔 / 159 只 distinct，{main: 159}，非主板 0**；留档旁路 1 行、自清理 0 残留 | 本轮 `ROADMAP.md` §44 / §44.5 `9am` |
| `_probe_dataset_board_scope.mts` + `.log` | 数据集声明实查：`dataset_version.id=390002` → `universeDefinitionJson={"universe":"all-a-shares","source":"stock_daily_prices","boards":["main"],"excludeSt":true}`；`dataset_build_config_board = main`；三条留档 `datasetSource=rebuild` + `datasetSecurityCount` 5146/5133 | 同上 |
| `_probe_trade_code_correctness.mts` + `.log` | 译码无歧义：`cand-270001` 的 188 只 distinct 中 **「同一 `securityId` 有多条 primary 行」= 0** ⇒ 排除张冠李戴；前缀分布 300×105 / 301×46 / 688×32 | 同上 |
| `tests/server/runWorkbenchAssembly/universeConstraint.test.ts`（**不在本目录**，登记于此便于溯源） | ✅ **8/8**：权威优先（build_config > universeDefinitionJson）、不猜（形状不符 → `none`）、非法板块抛 `UniverseConstraintError`（含 `unknown`）、`excludeSt` 只认严格 `true` | 同上 |

### `datasetwindow` —— 6 组（2026-09-14：运行**真正从绑定数据集取数** + 直读桥键域修正）

> 触发 = 用户「**策略运行的时候是需要从数据集中取数据啊**」（纠正上一轮把「每次运行都回落重建」当既成事实的登记）。
> 核心事实：**数据一直在** —— `ds_*_post`（rd≥1）实测 **471,816 行完整 OHLCV**、rd=+1 覆盖全部 23,978 个事件；
> 是**投影口径过窄**（旧桥只投 `prefix` 的 rd=0，每事件恰 1 行 = 23,978 行 ⇒ `executionBarsAvailable=false` ⇒ 必然回落重建）。
> 顺带抓到并修掉一条被本次改动**激活**的潜伏缺陷：旧桥把代码同时写进 `securityId` 与 `code`（键域违规）。

| 文件 | 结论要点 | 被引用于 |
|---|---|---|
| `_probe_dataset_window_coverage.mts` | ✅ 证数据集**有**撮合行情：post rd∈[1,20] **471,816 行**；rd=+1 覆盖全部 23,978 事件；rd∈[0,20] 合成逐日面板 **354,544 行**；**102,727** 个重复 `(symbol, tradeDate)` 组的 `close` 极差合计 **= 0** ⇒ 无损去重 | §44 / §44.5 `9an` / `PROJECT_RULES.md` |
| `_probe_bridge_window_cost.mts` | 成本实测：全窗口直读 ≈ **16.5s** vs 重建 **60.6s**（~**3.7×**）；旧口径（仅 rd=0）1.8s / 23,978 行；护栏由 20 万提到 **40 万**（计量对象改 `rows.length`） | 同上 |
| `_probe_symbol_identity_coverage.mts` + `.log` | ✅ **100%（2,967 / 2,967）** 事件 symbol 可在其事件日解析到唯一 `sec_<uuid>`（`NO_IDENTIFIER=0` / `AMBIGUOUS=0`）；`research_security_identifier_history` 仅 **5,552 行**、1.1s 可全量载入 | 同上 |
| `_probe_symbol_identity_bridge.mts` + `.log` | 键域分叉的证据基础：`ds_*` 三表**只有 `symbol`（代码域）**、canonical 身份在 `research_securities.securityId`（`sec_<uuid>`）；`ResearchDatasetRow` 的 `securityId`（身份）与 `code`（完整代码）是**两个字段** | 同上 |
| `_probe_dataset_window_run_e2e.mts` + `.json` + `.log` | ✅ **ALL PASS / 0 失败**（真实 tRPC `loopRun`，`cand-360004@1.0.0`，14.3s）：`datasetSource="registry"` / `note=null` / `versionId=390002` / 面板 **112,920 行 / 2,967 证券** / `backtest=EXECUTED` / **真实成交 35 笔**（修复前恒 **0 笔 / 全 SUSPENDED**）/ 期末 73,207.86；**身份域**：35/35 成交键全 `sec_<uuid>`（「代码形态」= **0**）、`researchRun.securityLabels` 解析 **35/35 = 100%**、板块 `{main: 35}`；留档 1 行、自清理 **0** | 同上 |
| `tests/server/runWorkbenchAssembly/windowProjection.test.ts`（**不在本目录**，登记于此便于溯源） | ✅ **18/18**：窗口解析 5（未声明 ⇒ null / 合法 / 非 `TRADING_DAY` / 五种非法值 / 非对象）+ 面板投影 9（rd 0..4、**决策日资格 = rd∈[1,3]**、`preClose` 链式、观察日流动性 null、**重叠无损合并**、数值冲突即抛 `REGISTRY_WINDOW_ROW_CONFLICT`、缺中间相对日、**`securityId` 取自身份映射且 `code ≠ securityId`**、缺身份即抛）+ 身份桥接 4（区间内/外、**code reuse**、歧义即拒、非法 symbol） | 同上 |

> 归档脚本（同轮）：`_append_archive_dataset_window.py`（`ROADMAP.md` §44 插入 + §44.5 `9an` + `ROADMAP-CHANGELOG.md` append）、
> `_append_rules_dataset_window.py`（`PROJECT_RULES.md` 追加两节：数据集窗口投影 / 键域 = `sec_<uuid>`）。

### `papertradingadvance` —— 7 个（2026-09-14：前向纸面交易「推进」按钮「提示成功但没变化」）

> 触发 = 用户「**前向交易闭环，推荐按钮有点问题**」（澄清后 = 「**推进 / 推进到最新**」按钮；现象「**提示成功但结果明显不对**」）。
> 核心事实：推进的**交易日历唯一来源 = `index_daily`**，而它**只有手动脚本写入、全仓无自动同步**，实查停更在 **2026-09-04**，而行情表已到 **2026-09-14**；
> 推进集合 `tradingDates.filter(d => d > lastProcessedDate)` 因此**恒为空** ⇒ 结构性 no-op 却报成功（`updatedAt == createdAt` 是「从未落过新状态」的旁证）。

| 文件 | 结论要点 | 被引用于 |
|---|---|---|
| `_probe_paper_trading_state.mts` | ✅ 只读实查：列运行状态 + `stateJson` 解析规模 + **三个日历末端对比**（`index_daily` 09-04 vs `stock_daily_prices` 09-14 vs `limit_up_records` 09-14）；两条运行 `lastProcessedDate` 均在日历末端之后、`updatedAt == createdAt` | `ROADMAP.md` §44 17:38 条 |
| `_probe_paper_trading_advance_dryrun.mts` | 内存干跑推进循环（**不 persist**，复刻 `db.ts` 循环）⇒ `datesToAdvance = []` ⇒ 证明「无待推日」是**结构性的**、不是撮合失败 | 同上 |
| `_probe_index_daily_freshness.mts` | `index_daily` 新鲜度：行数 / distinct 日 / 末端 / `retrievedAt` ⇒ 定位「日历停更」这一**数据面**根因 | 同上 |
| `_probe_paper_advance_e2e.mts` | ✅ **17 / 17 PASS**（真实 tRPC `appRouter.createCaller`）：补数后 `#1` **推进 09-11、09-14 两日**（`filled=5` / `open=3` / `exited=2` / `finalEquity=100,468.08` / `tradingDayCount=2`）、`stateJson` **1,960 → 3,466**、`equityCurve` 2 点；二次推进**如实 `already-latest`**；坏 id ⇒ `run-not-found`。⚠️ **会写入** `paper_trading_runs`（推进职责所在，已在文件头声明） | 同上 |
| `_probe_paper_create_guard.mts` | ✅ **5 / 5 PASS**：建运行**正向路径**（信号日 ≤ 日历末端）可正常创建 ⇒ 证明新守卫**不会误锁**新建运行；探针行按**可识别命名域** `PROBE-CALENDAR-GUARD-` 自清理、零残留 | 同上 |
| `_append_memory_paper_advance_diag.py` | 17:15 **诊断**小节追加脚本（append-only + 纯 LF 双向断言） | `.workbuddy/memory/2026-09-14.md` |
| `_append_memory_paper_advance_fix.py` | 17:38 **修复 + 实证 + 归档**小节追加脚本（同上纪律，含前缀不变断言「非 append-only」） | 同上 |

| 关联测试（**不在本目录**，登记于此便于溯源） | 结论要点 |
|---|---|
| `tests/server/paperTrading.test.ts` | ✅ **22 / 22**（原 10 例 + 新增 12 例）：`classifyAdvanceKind` 三态判定 5（含事故现场常量 `CALENDAR_END=2026-09-04` / `MARKET_END=2026-09-14`）+ `paperTradingAdvanceDiagnosis` 人话结论 6 + `PaperTradingCalendarStaleError` 1 |

> 归档脚本（同轮）：`_append_archive_paper_advance.py`（`ROADMAP.md` §44 插入 + §44.5 `9ao` + `ROADMAP-CHANGELOG.md` append + 本 README 分组）、`_append_rules_paper_advance.py`（`PROJECT_RULES.md`：数据源与回填补一条 + 新增一节）、
`_append_memory_paper_advance_diag.py` / `_append_memory_paper_advance_fix.py`（当日日志 append）、
`_verify_archive_paper_advance.py`（**回读校验**：锚点 / 编号先后 / 行尾 / 旧条目零改写，**ALL PASS**）。

## 🔴 2026-09-15 清理：`.py` 过程脚本全部移除（49 个 / 407.8 KB）

> **判据** = 引用扫描分桶（本仓库铁律：**按引用关系而非文件类别**）：**D 零引用 34** + **B2 仅本目录自身索引 4** + **B 仅被 `ROADMAP-CHANGELOG.md` / 当日日志提及 11** = **49 个**；**A 组 4 个全部保留**。（`REPO-HYGIENE-PY-SCRIPTS-001`）
>
> **性质**：这 49 个 `.py` **全部是一次性过程脚本**，**不含任何测量结论** ⇒ 不属于本目录要留存的「证据」：
> `_apply_*` 18（改 `ROADMAP.md` 字节级行手术）/ `_append_*` 18（追加日志与记忆文档）/ `_inspect_*` 7（只读打印行号找锚点）/ `_edit_*` `_fix_*` `_migrate_*` `_verify_*` 6（改源码、迁移组件、回读校验）。
>
> **根因（为什么会攒出 49 个）**：本仓库文档是**纯 CRLF 行尾**且禁用 `prettier --write` ⇒ 每次改文档都要临时写一个 Python **字节级行手术**脚本；又因 Windows 的 Python **看不到 Git Bash 的 `/tmp`**，它们被丢进本目录（当时唯一不进 `tsc` / `vitest` 的地方），自 2026-09-13 起累积 **49 个 / 407.8 KB**。
>
> **保留（A 组，一个没动）**：`scripts/providers/baostock_probe.py` / `baostock_corporate_actions.py` / `akshare_sw_probe.py` —— **本仓库技术栈确实不含 Python，但这三个是产品依赖**（`server/marketData/providers/pythonBridge.ts` / `akshare.ts` / `baostock.ts`、`server/security/baostock.ts`、`scripts/backfillCorporateActionsBaostock.ts` 经 `runPythonScript()` 子进程调用，删则切断 BaoStock / AkShare 数据桥）；`docs/legacy/upload_script_example.py` = 面人类 legacy 示例。
>
> **未动（一个没删）**：本目录全部**真探针**（`.mts` 121 / `.mjs` 12）与**运行结果**（`.log` 61 / `.json` 31 / `.md` 24 / `.txt` 6）；`server/**` `client/**` `shared/**` `drizzle/**` 零改动。
>
> **方式** = 用户裁定**真删除**：43 个原已被 git 跟踪 ⇒ 内容永久留存于 git 历史，`git checkout -- <path>` 可随时恢复；6 个未跟踪的是本轮新建的临时脚本，无需留档。
>
> **防复发**：一次性过程脚本**一律写到仓外** `C:\work\sourcecode\_scratch\`；细则见 `.workbuddy/memory/PROJECT_RULES.md`「🔴 过程脚本纪律（2026-09-15 起，强制）」；`.gitignore` 已加 `_*.py` 兜底。
>
> ⚠️ **本文件上文各分组里对 `_append_*.py` / `_verify_*.py` / `_apply_*.py` 的提及属历史记载** —— `PROJECT_RULES.md`「历史条目零改写」纪律要求不改写它们，但其指向的文件已于 2026-09-15 删除。

### 补充（2026-09-15，`REPO-HYGIENE-ROADMAP-TRIM-001`）：ROADMAP.md 整理带出的两件事

1. **有 3 个已删 `.py` 是被 `ROADMAP.md` 引用的**（上一轮的引用扫描漏判了，见当日日志的「扫描假阴性」自纠）：`_apply_schema_clbr.py`、`_edit_sentiment_page_leaderlist.py`、`_migrate_sketch_primitives.py`。它们出现在 `ROADMAP.md` §44「上轮实查」条目里，形式是「**该次手术由带 N 处断言的脚本执行**」—— 属**过程叙述，不是可复核的证据数据**。按用户裁定**保持已删**，与 CHANGELOG 里那 3 处的处理方式一致。
2. 🔴 这三处提及所在的 §44 历史条目，已在本轮 ROADMAP 整理中**整体移入 `ROADMAP-CHANGELOG.md`**（见其「ROADMAP.md §44 / §44.5 历史条目归档」小节）⇒ **这些 `.py` 的提及现在位于 CHANGELOG 的历史归档区**，属「历史记载」，其指向的文件已于 2026-09-15 删除。ROADMAP.md 整理前逐字节备份：`.cache/ROADMAP.md.before-cleanup-20260915`。

### 补充二（2026-09-15，`REPO-HYGIENE-ROOT-SCRATCH-001`）：根目录 3 个 `_*` 过程文件清理

| 文件 | 体量 | 性质 | 外部引用 |
|---|---|---|---|
| `_vitest_final.json` | 1,379,602 B | vitest 全量输出产物 | **零** |
| `_moveTestsToRoot.mts` | 7,473 B | 已执行的一次性迁移脚本（tests 迁至根目录） | 仅被下一行提及 |
| `_migrate_tests_rollback.mjs` | 2,059 B | 前者的物理逆操作（回滚保险） | **零** |

**判据**：本仓库铁律 —— **按引用关系而非文件类别**。全库（排除 `node_modules/`）grep 三个文件名，
**唯一命中** = `_migrate_tests_rollback.mjs` 自身注释里提到 `_moveTestsToRoot.mts` ⇒ 零外部引用。
三者**均已 git 跟踪** ⇒ `git rm` 后内容永久留存历史，`git checkout <commit> -- <path>` 可恢复。

**方式** = 用户裁定**三个全删**；同时裁定把「过程脚本一律写到仓外」的担保规则
**从 `_*.py` 扩到根目录锁定的 `/_*.mts` / `/_*.mjs` / `/_*.json`**。
⚠️ **锁定根目录（前导 `/`）是刻意的**：本目录下 11 个 `_*_probe.mjs` 是**已跟踪的真探针**，
若用无锚的 `_*.mjs` 会连它们一起忽略。已核对根目录 `components.json` / `package.json` /
`tsconfig.json` **不以 `_` 开头**、不受影响。细则见 `.workbuddy/memory/PROJECT_RULES.md`「🔴 过程脚本纪律」。

> ⚠️ 本目录内的 `_probe_sentiment_page_render.mjs`（2026-09-15 新建：情绪分析页真机渲染验收 ——
> 无头 Edge + CDP，断言「每日最高连板明细」整块已不存在 / 龙头列表默认折叠且卡片数 ≤ 6 /
> 点「展开其余 N 只」后卡片数 == 总数）**已补登记进 git 跟踪**，与另 11 个已跟踪 `.mjs` 探针一致
> （本节上文第一段的计数「`.mjs` 12」本已含它）。

> ⚠️ 本目录内的 `_probe_backtest_default_range.mjs`（2026-09-15 新建：**组合回测页默认回测区间验收** ——
> 无头 Edge + CDP，只读断言 `/backtest` 的「回测开始日期」输入框默认 `value == 2025-09-01`、
> 「回测结束日期」== 当天且 ≥ 起点；不点击、不触发回测）**已登记进 git 跟踪**，与其它已跟踪 `.mjs` 探针一致。

> ⚠️ 本目录内的 `_probe_backtest_trade_diff_removed.mjs`（2026-09-15 新建：**组合回测页「逐笔交易差异对比」删除验收** ——
> A 阶段真机 dev server 取 `Backtest.tsx` 模块（HTTP 200）断言产物不含 `data-trade-difference-table` / `逐笔交易差异对比` / `TradeDiffCell`，
> 仍含 `fullCycleTradeDifferences` 与 `ReturnLineChart`；B 阶段无头 Edge + CDP 真机渲染，等「全周期五策略收益对比」出现后断言
> `[data-trade-difference-table]` 元素数 == 0 且正文无该文案 / 「仅看有差异订单」，**同屏仍渲染全周期对比** = 「不存在」不是「没渲染」）
> **已登记进 git 跟踪**，与其它已跟踪 `.mjs` 探针一致。

> ⚠️ 本目录内的 `_probe_index_coverage.mts`（2026-09-15 新建：**指数行情同步「服务层」验收** ——
> 真库**只读**直调 `getIndexSyncOverview()`，打印 `index_daily` 覆盖、日历末端 vs 行情末端、
> 落后自然日/交易日、逐指数计划动作与区间、provider 可用性；**不发任何外部请求**）与
> `_probe_index_sync_page.mjs`（2026-09-15 新建：**`/stock-sync` 指数区块真机渲染验收** ——
> 无头 Edge + CDP，13 项断言含「落后告警 ↔ 本次计划」**口径一致性**，**只读、绝不点击同步**
> 以免消耗 tushare 配额；🔴 随机端口 + `taskkill /F /T` 杀整棵进程树，
> 避免残留渲染子进程导致 CDP 连到空白页而全部假失败）
> **已登记进 git 跟踪**，与其它已跟踪探针一致。

> ⚠️ 本目录内的 `_probe_today_gap.mts`（2026-09-15 新建、同日扩至 15 节；**「某天为何不出现」总诊断**）——
> 真库**只读**一次性读齐「某天为何不出现」的**判据链**：① 日历末端（`index_daily`）② bar 覆盖（`stock_daily_prices`）
> ③ **数据集窗口**（`dataset_version`；🔴 **仅 `registry` 直读路径**是硬边界，`rebuild` 回落用用户窗口）④ 运行推进进度（`paper_trading_runs.lastProcessedDate`）；
> 另附 **DB 时区校准**（判「盘后」还是「盘中」快照）、**「涨停记录驱动」覆盖实证**、**组合回测留档窗口**、
> 以及 **legacy「原来的」回测（`/backtest`）专段**：`limit_up_records` 末端（它的信号源）、
> **信号日资格复刻**（`leaderCandidates.ts:951-958` 的 `if (!nextDate) continue` ⇒ 可回测末日 = 日历倒数第 `observationDays+1` 个交易日，**当天必然缺席**）、
> 昨日信号的 **T+1 观察数据是否就位**；**不写库、不发任何外部请求**；**已登记进 git 跟踪**，与其它已跟踪探针一致。

> ⚠️ 本目录内的 `_probe_dataset_vs_today.mts`（2026-09-15 新建，**「组合回测跟数据集有没有关系」判定**）——
> 真库**只读**一次读齐：`dataset_version` **声明窗口** vs `ds_*` 三表**内容**实际覆盖（event / post 的 min·max `tradeDate`）、
> 目标日当天有无行、各策略的 `datasetVersionId` 绑定与 `observationWindow` 声明、
> **判定表**（`dateRange` 终点设目标日时各策略走 `registry` 还是回落 `rebuild`、是否越界）、
> 以及 `closed_loop_backtest_run` 留档的 `datasetSource`；**不写库、不发任何外部请求**；
> **已登记进 git 跟踪**，与其它已跟踪探针一致。

> ⚠️ 本目录内的 `_probe_assemble_window_bounds.mts`（2026-09-15 新建，**装配层 / 会话层「窗口边界」分层实证**）——
> 同一策略、同一份文档，只改 `endDate` 跑**两个对照用例**（`2026-09-15` 越界 vs `2026-09-01` 窗口末），
> 各打印装配结果（`datasetSource` / 行数 / 直读产物窗口）并调用 `createDatasetSession` 观察是否 FAIL FAST；
> 实测结论 = **装配层不校验、会话层抛「超出数据集窗口」**；每次约 11s（直读 390002 投影约 11 万行）；
> **不写库、不发任何外部请求**；**已登记进 git 跟踪**，与其它已跟踪探针一致。

> ⚠️ 本目录内的 `_probe_planned_position_render.mjs`（2026-09-17 新建，**「组合回测 → 交易明细」快照面板「比例在表格里」验收**）——
> 无头 Chrome + CDP **零依赖**、**只读**（不点任何写操作按钮）：点开「交易明细」页签 → 等
> `[data-strategy-portfolio-snapshot]` 与「准备买入」表渲染 → 读两张表的表头 / 行 / `tfoot` → 再逐个切换五策略复读。
> 断言含：① **反证段落钩子**（`[data-planned-position-sizing]` 与 `[data-planned-position-chips]` 必须**不存在**，
> 即比例只能出现在表格里）；② 当前持仓表头含「持仓市值 / 占总权益」，逐行同时给金额与 `x.xx%`；
> ③ **资金恒等式** `合计行现金 + 持仓市值 ≈ 总权益`（±1%）—— 这是「占比」分母正确的硬证据；
> ④ 准备买入表头含「计划仓位」，逐行 `[data-planned-position]` 单元格含 `x.xx%` 与 `¥金额`，
> `Σ(逐只比例) ≈ 合计行总比例`，合计行回显口径与「股数待次日开盘价确定，开盘前不预估」；
> ⑤ 口径来源徽标 `[data-portfolio-provenance]` 存在 —— 如实标注该快照由 **research-legacy 交易模拟器**
> 产出、与「回测总览」的 **生产 Strategy Engine 段非等价**（🔴 引擎段每笔固定 100 股、**不读分仓下拉**；
> 实证 = 生产核心快照 1232 笔成交 `shares` 全为 100，详见 `ROADMAP-CHANGELOG.md` 的 `9av` 条）。
> ⚠️ `/backtest` 走 `getLeaderCandidateResearch`（**仅内存缓存**，进程重启即冷）⇒ **冷算数分钟到 20 分钟**，
> 本探针按 `WAIT_SEC`（默认 1800s）耐心等待，并把中间结果**同步落盘** `_probe_planned_position_render.json`。
> 另有 `CDP_PORT` / `PAGE_URL` 两个旋钮（并发跑别的探针时改端口）。**已登记进 git 跟踪**。
> 同面板的截图探针 = `_shot_planned_position_panel.mjs`（就绪判据已随之改为 `[data-strategy-portfolio-snapshot] tfoot`）。

> ⚠️ 本目录内的 `_probe_app_boot_render.mjs`（2026-09-17 新建，**「服务起来了但页面是不是白屏」全站启动渲染验收**）——
> 无头 Chrome（注意：用 `chrome.exe`，非 Edge）+ CDP **零依赖**，单浏览器实例逐路由
> `Page.navigate` → 轮询 DOM 直到有内容或超时 → 量 `innerText` 长度 / `h1,h2` / 侧栏链接数 /
> **`Failed to fetch` / `加载异常`文案** / `window.__errs`（经 `addScriptToEvaluateOnNewDocument` 钩住
> `error` / `unhandledrejection` / `console.error`）；结果**同步落盘** `_probe_app_boot_render.json`（探针被中断日志仍在）。
> **两个 env 旋钮**：`ROUTES=/a,/b`（默认 11 条主路由）、`WAIT_SEC=N`（默认 25s）。
> ⚠️ **实测 `/stock-sync` 冷启动 > 25s 才出内容**（该路由首屏慢是既有事实，不是白屏）⇒ 复测它必须 `WAIT_SEC=70`。
> **只读、零写入、不点按钮**；**已登记进 git 跟踪**，与其它已跟踪探针一致。

> ⚠️ 本目录内的 favicon 工具链（2026-09-17 新建，**标签页图标 = 首页左上角侧栏 Logo 的矢量复刻**）——
> 三件套须按顺序跑：`_gen_favicon_svg.mts`（**生成器**：从 `node_modules/tailwindcss/theme.css` 取
> `orange-500` / `red-600` 的 oklch 令牌、从 `client/src/index.css` 取 `--radius`、从 `AppShell.tsx` 取
> 类名与图标名、从 `lucide-react` 取字形节点 ⇒ 生成 `client/public/favicon.svg`，**生成物禁手改**）
> → `_gen_favicon_assets.mjs`（无头 Chrome 把该 SVG 栅格化成 `favicon-16x16.png` / `favicon-32x32.png` /
> `apple-touch-icon.png` / `favicon.ico`，**不引入任何依赖**：本机既无 Pillow 也无 ImageMagick）
> → `_probe_favicon_render.mjs`（**验收**：与真机 4× 实拍逐像素对拍）。
> 🔴 **两个踩过的坑**：① XML 注释里出现**连续两个短横线**（当时顺手写了 `--radius-lg`）⇒ 整份 SVG
> 解析失败、图标根本不显示；② 页面的 `bg-gradient-to-br` 在 CSS Color 4 下**按 oklab 插值**，而 SVG 渐变
> 只能按 sRGB 插值 ⇒ 只给两个端点色标时**中调偏差达 12/255**，生成器改为用 12 个色标折线逼近 oklab 曲线后
> 降到 **≤1/255**（色标位置**自适应插入**：真曲线在 sRGB 色域边界有折角，均匀分段压不下去）。
> 验收口径 = **日间**主题下对拍（夜间态被 `darkCompatibility.css` 用 `color-mix` 压低色度，属主题差异而非图标差异）：
> 纯背景区峰值差 **2/255**、字形掩膜 **IoU 0.9984**、渐变端点与中调 **≤1/255**、5 个资源均 200 且
> PNG/ICO 头部尺寸与声明一致；`WAIT_SEC` / `CDP_PORT` 两个旋钮可调。**只读**，唯一输出 = 证据图 `_evidence_favicon.png`。

> ⚠️ **分仓口径核对**（2026-09-17 新建，回答「页面为什么显示 100%」）—— `_probe_position_sizing_caliber.mts`：
> 用**唯一权威实现** `server/positionBudget#allocatePlannedBudgets` 喂真机渲染抓到的真实运行时数字，
> 把 **等权 / 评分加权 / 固定单笔比例 20%** 三种口径在同一批计划上并列复算。
> 🔴 实测结论（**全部断言通过**）：
> ① **等权 = 可用现金 ÷ 本批笔数** ⇒ 当日只有 1 只入选时，该笔必然吃掉 **100% 可用现金**；
> ② **评分加权在单笔时退化为满仓**（合计分 = 本笔分），与等权同值；
> ③ **固定单笔比例 = 初始资金 × 20%**，**与权益增长脱钩**（真机数据里 = ¥20,000/笔，
> 只相当于**当前权益的 2.69%** —— 这是「每笔恒定比例」而非「1/5 当前资金」）；
> ④ 两笔时等权各 1/2 且**合计恰为全部可用现金**（¥230,419 × 2 = ¥460,838）。
> ⇒ 页面上的 100% **不是计算错误，是「等权」在该情形下的定义结果**；
> **系统里目前没有任何口径给出「单只 = 当前权益 ÷ 最大持仓数」**（该语义只能作为**单标的上限**引入，
> 而用户已明确**不设上限**）。
> ⚠️ 影响面（按快照 `historicalRows` 实测按 `nextDayDate` 分组）：745 个决策日里 **384 天只有 1 只候选**；
> **2019–2024 日均候选仅 1.2–1.8 只**（多数日子等价于满仓单票），2025 起才变密（2026 日均 44.9 只、0% 的日子候选 <5）。
> **只读**：不连库、不发请求、不写任何文件；数字改动需同步改 5 个策略的常量。
> ⚠️ **止损口径偏差审计**（2026-09-18 新建，`9bd` · STOPLOSS-PARITY-AUDIT-001；`9be` 修复后翻转断言）—— 四个**只读**探针：
> ① `_probe_stoploss_divergence.mts`：用**同一条价格路径**分别喂组合回测（`server/realisticBacktest`）
> 与 前向纸面（`server/paperTrading`），逐字段比对 `exitDate / exitPrice / reason`。
> 🔴 `9bd` 初版断言方向 = 「**偏差存在**」（12/12 通过）：**前向纸面完全没有「开盘阶段止损」** ——
> 建仓 10.00、止损 5%（止损价 9.50）时，T+2 开 **9.40** 收 **10.60** ⇒ 回测按开盘 9.40 出清、
> 纸面**根本不出清**；开 9.40 收 **9.20** ⇒ 回测 9.40 / 纸面 **9.20（低 2.13%）**；
> **对照组「仅盘中破位」两端都按 9.50 出清** ⇒ 偏差**只**在开盘分支。
> ✅ **`9be` 已把断言方向翻转为「两端等价 + 唯一刻意分叉」**（全部通过）：D1 修复后两端退出日 /
> 成交价 / 原因三处**逐位一致**；唯一差异是**纸面专属**的「组合无条件止损」（回测源码零命中），
> 并附反证「`portfolioStopLossPercent: 0` ⇒ 纸面复原等价」「`exitJudgementPhase: "close"` ⇒ 有意的时点差异」。
> 🔴 **翻转原因是本探针最重要的一课**：D1 修好之后，旧版「断言偏差存在」的探针**必然失败** ——
> 留着它等于把 bug 当规范。**修完缺陷必须同步翻转断言方向**。
> **不连库**；输出落盘 `_probe_stoploss_divergence.out.txt`。
> ② `_probe_paper_run_params.mts`：真库**只读**读 `paper_trading_runs` 的参数快照与出清原因分布。
> 🔴 实测 4 条运行的 `paramsJson.realistic` **只含 `initialCapital`**（7 项止损参数全走硬编码缺省）；
> 10 笔已出清里 **0 笔**「开盘触发止损」。⚠️ 这是**历史事实**（已推进过的日子不可回溯、新规则只在此后的
> 推进日生效），**不要读成「分支仍不存在」** —— 分支存在性看 ① 的源码断言。
> ⚠️ 两个坑：**须非沙箱运行**（本机沙箱内出站被拦）；首连可能被 **TiDB Serverless 冷启动**掐断
> （`Connection lost`），重跑即可；`.env` 的 `?ssl={"rejectUnauthorized":true}` 必须**按 JSON 提取后以对象传入**
> （`mysql2` 误当 SSL profile 名）。输出落盘 `_probe_paper_run_params.out.txt`。
> ③ 🔴 `_probe_inflight_runs.mts`（`9be` 新建，真库**只读**）：**改 `server/**` 前的在途 Run 闸门** ——
> 改 server 会热重启并**杀掉在途 Run**，动手前必须证明「零 RUNNING」。扫 `information_schema` 找出**所有**
> 含 `status` 列的表（实测 23 张），逐张 `COUNT(status='RUNNING')` 并打印命中行的**时间戳**。
> 两条设计要点：① **不做猜测式白名单**（只查 1 张表就报「零在途」是旧事故形态）；② 只报「有 RUNNING」不够，
> 必须给时间戳让人区分**真在途**与**历史僵死**，否则会误杀用户正在跑的任务。实测：所有真实 Run 表 RUNNING=0；
> 唯一命中 `research_question` #270001 的时间戳停在 **30 小时前**、且服务在其后已重启过 ⇒ **僵尸态**。
> 输出落盘 `_probe_inflight_runs.out.txt`。
> ④ ✅ `_probe_paper_settings_render.mjs`（`9be` 新建，无头 Chrome + CDP，**只读**）：
> 「前向纸面交易」**策略设置 + 生效参数**的前端可达性验收，**18/18 通过**。断言：三组设置容器
> （exit / position / constraint）齐备；判定时点下拉 3 选项且缺省 `both`；「组合无条件止损」输入缺省 = 3；
> 数值项 10 个；成交可行性开关 5 个且**默认全关**（= 改动前行为）；页面含纸面专属差异的如实声明；
> 判定时点**可交互**（改 `close` 读回 `close`，点「恢复默认设置」回到 `both`）；详情页「该运行实际生效的参数」
> 面板渲染、组合止损行 = 3%、**至少一行如实标注「默认」**、无 `undefined/NaN`。
> ⚠️ 坑：受控 `<select>` 必须走**原型上的 native value setter** 再派发 `change`，直接 `el.value = x`
> 会被 React 的 value tracker 判为「没变化」⇒ 探针**假通过**（页面其实没动）。**不点「创建」**（会真建运行）。
> 输出落盘 `_probe_paper_settings_render.json`。
> ⑤ ✅ `_probe_backtest_layout_pagination.mjs`（`9bf` 新建，无头 Chrome + CDP，**只读**）：
> 「组合回测」页签归属 + 「全部模拟订单」分页的前端可达性验收，**50/50 通过（零 SKIP）**。断言：六页签标签与顺序；
> 回测总览 = 全周期五策略收益对比 + 当前持仓与下一交易日准备买入 + 全部模拟订单，且三块迁出物（统一策略评价 /
> 高位连板风控生效情况 / 资金与仓位审计）**均不得出现在总览**；策略对比含 `data-strategy-evaluation`、
> 风险归因含 `data-board-height-impact`、交易明细含 `data-capital-position-audit`（后两页不得出现订单表）；
> 分页：第 1 页 20 行 / `1 / 52` → 「下一页」`2 / 52` 且首行不同 → 「最后一页」`52 / 52` 共 9 行 →
> 每页条数改 10 ⇒ 回到 `1 / 103` 且 10 行 → 关键词筛选 ⇒ 回到第 1 页且行数 = 页内区间长度。
> ⚠️ 坑一：Radix Select 只认 **pointerdown**，纯 JS `el.click()` 打不开下拉 ⇒ 必须用 CDP
> `Input.dispatchMouseEvent` 发真实鼠标事件（本探针用真鼠标做翻页与下拉）；受控 `<input>` 同样要走
> 原型 native value setter + 派发 `input` 事件。
> ⚠️ 坑二：探针自带**空闲端口探测** —— 上一轮残留的无头 Chrome 会占住 30000/30001 之类高位端口，
> 固定/盲随机端口会让 Chrome 静默起不来。
> ⚠️ 坑三：该页数据来自 `sentiment.getLeaderCandidateResearch`（冷算可达数十分钟）⇒ 数据相关断言在
> 40 分钟窗口内未就绪时一律记 **SKIP 并如实报「未验证」**，绝不谎报 PASS。
> ⚠️ 坑四（`9bf` 用户实报「策略对比下的样式乱了」后新增）：新增 **H 组「同屏卡片几何一致性」** —— 总览 / 策略对比 /
> 风险归因 三页签逐个断言同屏卡片的左边距与宽度一致（±1px）。🔴 **必须量卡片本体**：锚点优先取 `> .rounded-2xl` 子元素、
> 否则取锚点自身 —— 直接量锚点会得到 `280/1255` vs `304/1207` 的**假差异**（差的正是容器那 24px 内边距）。另有 **H2 反事实对照**：
> 当场把容器 div 的 class 剥掉，卡片必须立刻变宽（`[304,1207]` → `[280,1255]`）⇒ 证明容器类是**承重件**而非装饰。
> 输出落盘 `_probe_backtest_layout_pagination.out.txt`。

---

### `backtestriskblocks` —— 1 个（2026-09-18 事项 `rZPX8O`「回测总览页面添加功能」）

> **背景**：用户要求在「回测总览 → 全周期五策略收益对比」折线图**下方**加入区块，
> 逐策略展示「最大回撤 / 回撤持续时间 / 收复回撤所用时间 / 最大收益百分比 / 当前收益百分比」。
> 交付 = `client/src/lib/fullCycleRiskBlocks.ts`（纯函数派生，回撤三项**搬运服务端权威值**）
> + `client/src/pages/Backtest.tsx#FullCycleRiskBlocks`（锚点 `data-full-cycle-risk-blocks` /
> `data-full-cycle-risk-card={<key>}`，渲染在 `data-full-cycle-comparison` 卡片**内部**）。

| 文件 | 结论要点 | 被引用于 |
|---|---|---|
| `_probe_full_cycle_risk_blocks.mjs` + `.out.txt` | ✅ **PASS 37 / FAIL 0 / SKIP 0 ⇒ ALL PASS**（研究数据 15s 就绪）。**A** 区块在折线图同卡片内、折线图下方 447px；**B** 恰 5 张卡，key 与标题顺序正确；**C** 5 × 5 项指标齐全且格式合法（百分比 / N 个交易日 / 样本不足），收益两项无「样本不足」；**D 口径交叉核对 20 / 20** —— 区块四项与「策略对比 → 六层评价」**同一策略列**的 `Max Drawdown` / `最大回撤持续时间` / `最大回撤恢复时间` / `Total Return` **数值逐个相等**（**`9bh` 新口径**下：原始策略 `40.39% / 19 / 16 / 364.2%`、质量门控 `59.42% / 111 / 43 / 60.85%`）；**E 几何** —— 5 张卡同排等宽 223px × 5、同一 top，行左边缘 325 与折线图 325 **逐像素对齐**、行宽 1165 = 折线图 1165，且不越出所属卡片 `[280,1535]`。🔴 两项时长的口径（`9bh` 起）= 锁定**最大回撤那一次**区间：持续＝峰值日→谷底日、收复＝谷底日回到前高（未收复计至期末）⇒ D 段交叉核对**仍成立**（两侧同源）。 | `ROADMAP.md` §44.5 `9bg` + `9bh`（口径修订）、`ROADMAP-CHANGELOG.md` 同名条目 |

> ⚠️ 坑一（本轮真踩）：**探针输出禁止接管道**。本沙箱 Bash 的 `head` / `tail` 不在 PATH 上 ⇒ 管道读端
> 立刻关闭 ⇒ 探针 `console.log` 抛 `EPIPE` 并触发 `uncaughtException` **提前中止**；更糟的是探针开头的
> `fs.writeFileSync(OUT, '')` **已经把上一份好结果清空**（本轮一次误加 `| tail -40` 直接毁掉一份 37 项全绿的留档）。
> 正确做法 = `run_in_background` 直接跑（不加任何管道），只读同名 `.out.txt`。
> ⚠️ 坑二：卡片标题取**服务端实验的 `label`** —— 首项是**「原始策略」**，与订单/持仓页签用的
> 「原始评分基准」是**不同来源的同义标题**，探针断言不可混用（首跑因此假 FAIL）。
> ⚠️ 坑三：卡片脚注必须取 `querySelectorAll('p')` 的**最后一个** `p`。`p:last-of-type` 按**各自父节点**
> 判 last-of-type（不按文档序）⇒ 会先命中卡内 flex 容器里那个**唯一的标签 `p`**，读出标题而非脚注（首跑第二个假 FAIL）。

---

### `homepagerework` —— 1 个（2026-09-18 ~ 09-19 事项 `rKRNzQ`「大盘日线走势图」，共四轮）

> **背景**：用户对首页（`/`，HOMEPAGE-001，`9be` 产物）提 5 条要求 —— ① 展示库里四条指数、区块过大且日期太少
> ⇒ 更小区块 + 更多日期 + 四指数并列；② 成交量/两融/涨停数图「右侧坐标有两个」；③ 连板梯队与题材热力图换位；
> ④ 连板梯队要附件 `QQ20260918-230855.png` 的版式；⑤ 首页加载过慢。
> 交付 = `client/src/pages/Dashboard.tsx` 重写（拆成 `IndexTrendSection` / `MarketOverviewSection` /
> `BoardLadderSection` / `SectorHeatmapSection`，各卡自持 query + 骨架屏）+ `server/boardRoster.ts` 新增
> `firstBoardStocks` / `changePct` / `oneWordBoard` + `server/db.ts#getLimitUpWithMarketData` 改服务端聚合。
> **2026-09-18 追加（`9bj`）**：连板梯队左列「高度」口径按用户裁定改为**「若该股本日涨停会达到的连板数」**（断板 +1 / 首板未续不 +1），唯一实现 = `shared/ladderHeight.ts`，本文末行探针为其定案证据。
> **2026-09-19 第三轮追加（`9bk`）**：用户四条 —— ①「首板未续」也要 +1；② 高度行 > 3 时加折叠按钮且默认折叠；③ 梯队行内按题材**当日**热力排序、**无关是否断板**；④ 题材热力图的排序规则按**当日**数据而不是合计。交付 = `shared/ladderHeight.ts`（改 `brokenKind ? boards + 1 : boards`）+ 新增 `shared/sectorHeatOrder.ts`（当日题材热度查表 + 降序比较器，梯队与热力图**共用**）+ `client/src/pages/Dashboard.tsx`（默认折叠 `LADDER_VISIBLE_ROWS=3` / 行内断板与涨停混排 / 热力图换排序键）+ `tests/shared/sectorHeatOrder.test.ts`。⚠️ 副产品认知：**「附件图可见的那一部分不含某类」≠「该图不含该类」** —— 上一轮据此推断「首板未续不 +1」，本轮被用户裁定推翻（附件 2 板行 8 格只是 38 格的子集）。
> **2026-09-19 第四轮追加（`9bl`）**：用户澄清折叠口径 —— 原话「**之前说的超过三行折叠是每个高度内超过三行折叠那个高度到只有三行**」。⇒ `9bk` 的「**整个梯队的高度行** > 3 ⇒ 只留最高 3 行」属**口径错读**，改为**每个高度组各自判断**（该组网格行数 > 3 ⇒ 该组折到 3 行，本组按钮展开/收起）。交付 = `client/src/pages/Dashboard.tsx#LadderGroupGrid` + `useGridColumnCount`（`LADDER_VISIBLE_ROWS` → `LADDER_GROUP_VISIBLE_ROWS`；旧锚点 `data-homepage-ladder-toggle` / `-rows-total/-visible` 删除 → 新锚点 `data-ladder-grid*` + `data-homepage-ladder-group-toggle`；整梯队不再整体收起）+ 探针 F 节重写为逐组断言（47 → **48** 条）。⚠️ 副作用认知：**「行」在响应式网格里必须先换算成「格」**（3 行 = 3 × 当前列数），列数取自计算样式而非另立断点表。用户同时裁定：`limit_up_records` 2026-09-16 名称错录**由用户自行处理，本项目不再跟踪**。


| 文件 | 结论要点 | 被引用于 |
|---|---|---|
| `_probe_homepage_rework.mjs` + `.out.txt` | ✅ **PASS 48 / FAIL 0 / SKIP 0 ⇒ ALL PASS**（`9bl` 第四轮后复跑；较上轮 +1 条断言）。**F 折叠（本轮重写为「组内」）**：实测（列 6）`6 板 1 行 / 4 板 1 行 / 3 板 1 行`（均无按钮、无裁切）· `2 板 7 行 → 默认 3 行 / 渲染 18 格`、`首板(66) 11 行 → 默认 3 行 / 渲染 18 格`（各带本组按钮 `data-homepage-ladder-group-toggle` + `aria-expanded=false`）；**只点第 1 个可折叠组** ⇒ 该组 `7/7@true`、首板仍 `3/11@false`（证明是组内开关）；逐组展开后全部 `rows-visible = rows-total`；**整个梯队高度行不再整体收起**（`renderedRows=5 = grids=5`，「2 板」「首板」默认即在 DOM）。**G 排序**：梯队每个高度行内「题材当日涨停家数」**非递增**（样例 4 板 = `7, 6, 3`）、**断板格与涨停格交错**（交错行 = `4 板 / 3 板 / 2 板`）；热力图第一数据列 = `09-18`、该列显示值**逐行等于**服务端当日真值、行序非递增（`7 > 6 > 6 > 6 > 5 … > 0`），⚠️ **合计列非单调**（`64,98,50,6,82,…`）⇒ 直接反证「不是按合计排序」。**H 首板未续**：2 板行 **38 格（其中断板 30 格）**同时含涨停格与断板格；首板行 **66 格、零删除线**。**D 全量版式（逐组展开后）**：分组 `6 板(1 格) / 4 板(3 格) / 3 板(5 格) / 2 板(38 格) / 首板(66)(66 格)`、6 列网格、**35 格删除线断板**且首行为涨跌幅、3 格「一字板」标、非断板格首行 = `HH:MM`。**A/B/C/E 与零回归全部保持 PASS**：4 张指数卡同 top（`tops=[217]`）×276px×120 交易日、三合图恰 2 个绘图面且**右侧带刻度纵轴只有 1 条**、两联绘图区 `[389,389]` 对齐、`ladderTop=1029 < heatTop=2210`、两重卡片容器 677ms 同存且指数图 3655ms 早于梯队表 4568ms；热力表「合计」列 / 快捷入口 4 个 / 免责声明 / 标题「行情总览」/ 无残留骨架屏 | `ROADMAP.md` §44 `9bl`、`ROADMAP-CHANGELOG.md` 同名条目 |
| `_shot_homepage.mjs` | 整页 / 局部截图（第 4 参传 CSS 选择器即裁剪该元素、**第 5 参传选择器则先点击再截**，用于截「展开后的梯队」），供人工目视核对版式 | 同上（目视附件） |
| `_probe_homepage_data_sources.mts` + `.out.json` | 改造前数据源对账：`index_daily` **恰四条**指数（各 1873 行 / 2019-01-02~2026-09-18 / close 0 空值）；`market_data` 218 行、末端 2026-09-17；`limit_up_records` 最新记录日 78 只；`stock_daily_prices` 在最新记录日覆盖 441 只（含全部涨停股） | 同上 |
| `_probe_ladder_quote_fields.mts` + `.out.json` | 版式字段可行性：最新日 78 只涨停股行情 **78/78 覆盖**、断板场景 88/89；**一字板判据（`open==high==low`）命中 经纬股份 / 华纺股份 / 百通能源** —— 前两只与用户附件图 2 板行的「一字板」标**逐只吻合** | 同上 |
| `_probe_ladder_caliber_drift.mts` + `.out.json` | 高度口径对拍（首轮）：给出 5 只断板股差 1 板的**清单**；⚠️ 当时对成因的推测「附件图 = 工具源的「N天M板」**累计口径**」**已被 `9bj` 推翻、作废**（真正含义 = 若本日涨停会达到的连板数）。意外收获：**2026-09-16 名称错录**（`001216.SZ`→「华统股份」、`603248.SH`→「镌华科技」） | `ROADMAP.md` `9bi`（成因结论作废）、`9bj` |
| `_probe_ladder_height_caliber.mts` + `.out.json` | ✅ **`9bj` 定案依据**。⒜ 澳弘电子 `605058.SH` 连板链 = `09-11 / 09-14 / 09-15 / 09-16 / 09-17`（09-12/13 周末，**无断档**）⇒ 本算法 5 板正确、附件 6 板非数据缺口；⒝ 库内 `boardCount` 列**基本全 NULL**（只在首板行填 `1`）⇒ **不可作真源**（窗口内 952 行与重算不一致）；⒞ 断板股逐只：澳弘电子 5→6 / 中晶科技 3→4 / 共达电声·中岩大地·万向德农 2→3，当日涨停股 4→4、3→3 ⇒ **断板 +1、涨停 +0** | `ROADMAP.md` §44/§44.5 `9bj`、`shared/ladderHeight.ts`、`tests/shared/ladderHeight.test.ts` |
| `_probe_board_roster_after_change.mts` + `.out.json` | 改造后名录字段核对：`firstBoardStocks` 66 只、`oneWordBoard` 78/78 有值、`changePct` 34/35（1 只缺行情 ⇒ 如实 `null`）；分组格数 `5板1 / 4板2 / 3板3 / 2板11 / 首板(66)96`（⚠️ 该次运行早于 `9bj` 口径修订；修订后 = `6板1 / 4板3 / 3板5 / 2板8 / 首板(66)96`） | 同上 |
| `_probe_homepage_timing.mts` + `.out.json` | 首屏耗时基线（**交错 3 轮取中位**）：单指数 296ms / 四指数串行 1197ms / **四指数并行 303ms** / 单条窗口函数 SQL 349ms / 三合图 925ms / 题材分布 466ms / 连板名录 446ms ⇒ 并行批量已够，**未新增端点** | 同上 |

> ⚠️ 坑一（本轮真踩，三处）：**主机侧正则被「习惯性二次转义」**。探针文件里直接写的正则字面量用 `/^\\d+\\s*板$/` 会匹配「反斜杠 + d」⇒ **全部假 FAIL**；
> 而**同一探针内、写在传给浏览器的模板串里的**正则**必须**保留 `\\d`（否则被 JS 字符串吃掉）。判断依据 = **这段正则最终由谁解析**。
> ⚠️ 坑二：recharts 的 **Legend 图标也是 `svg.recharts-surface`**（宽约 14px）⇒ `querySelectorAll('.recharts-surface')` 会把图例算成绘图面，
> 「联数」虚高、`.recharts-cartesian-grid` 取不到而读出 `null`。必须按尺寸过滤（本探针取 `width > 300`）。
> ⚠️ 坑三：`jsonEval` 的表达式若写成 `(function(){...})` **忘了末尾 `()`**，CDP 会把函数对象序列化成 `undefined` ⇒ 断言静默记 SKIP（本探针首跑 4/9 项因此跳过，而非 FAIL —— **SKIP 不掉以轻心**）。

> ⚠️ 坑四：断板股首行的涨跌幅可能因**行情缺失**呈现「—」⇒ 断言必须允许该形态（这正是「不推算」的正确表现），若只断言「含 %」会把正确实现判成 FAIL。
> ⚠️ 坑五（第三轮真踩）：**默认折叠会把「全量行」断言变成「假 SKIP」**（不会报 FAIL，更隐蔽） 梯队改为默认折叠后 `[data-ladder-group]` 只剩 3 行 ⇒ 直接跑版式断言会看不到「首板(N)」行与低高度行（上一轮那几条会静默 SKIP，而不是 FAIL）。正确顺序 = **先断言折叠态**（`data-homepage-ladder-rows-total` / `-visible` + `aria-expanded`）→ **再点按钮展开** → 才做全量版式断言。
> ⚠️ 坑六：`aria-expanded` 是**字符串** `'false' / 'true'`（不是布尔）⇒ 断言必须比字符串，写 `=== false` 会假 FAIL。另：原生 `<button>` 用 DOM `el.click()` 即可（**只有 Radix 受控控件**才必须走 CDP `Input.dispatchMouseEvent` 真实鼠标）。
> ⚠️ 坑七（本轮新学，复用价值高）：**要独立取服务端真值做对拍，不必自己拼 tRPC 请求体** —— 无输入 query 直接 `fetch(BASE + '/api/trpc/<router>.<procedure>')` 即 **200**（返回 `{result:{data:{json:…}}}`）；带输入则 `?input={"json":{…}}`。本探针用它把「梯队行内热度非递增」与「热力图当日列 = 服务端真值」做成**跨进程对拍**，而不是复述前端代码逻辑（否则等于自证）。
> ⚠️ 坑八：判「排序键是当日还是合计」**不要**只断言「当日列非递增」—— 顺带记录**合计列是否也非递增**：本日实测合计列 `64,98,50,6,82,…` **非单调** ⇒ 直接反证「不是按合计排序」，比间接推断有力。
> ⚠️ 坑九（第四轮真踩，复用价值高）：**「超过 N 行」在响应式网格里不是常量** —— 网格列数随断点变（`grid-cols-2 / sm:3 / lg:4 / xl:6`），「3 行」对应 6/9/12/18 格。别写死格数，也**别另立一张断点表**（会与 `grid-cols-*` 类漂移）：读 `getComputedStyle(grid).gridTemplateColumns` 的 token 数，并在 `ResizeObserver` 里同步；⚠️ **只在值真的变了才 `setState`**，否则观察自身高度变化会打成渲染环。
> ⚠️ 坑十：**JSX 正文不吃 Markdown** —— 卡片描述里写的 `**加粗**` 会**原样渲染成星号**（本轮看截图才发现，顺手清了 4 处）。文案强调要用 `<strong>` / `className`，别照抄 Markdown 习惯。
> ⚠️ 探针纪律（第四轮成型）：**折叠态断言必须先「逐组展开」再跑全量版式断言** —— 组内折叠会让被折的组只渲染 3 行，直接数格数会得到「少一半」的假象（若断言写成「≥ 某数」则静默变 SKIP）。顺序固定为 F（折叠态 + 展开）→ D（全量版式）→ G（排序）。

---

### `navhighlight` —— 1 个（2026-09-15 建；2026-09-19 `9bm` / HOMEPAGE-005 扩用到「首页入口」）

> **背景**：2026-09-15 用户报障「侧栏高亮串板块」—— 旧 `AppShell.tsx` 用 `location.startsWith(item.path)`
> ⇒ `/backtest-runs`（回测历史）把 `/backtest`（组合回测）一起点亮。
> 修法 = **分段精确匹配 + 全局取最长命中**（`normalizePath` 剥 query/hash/尾斜杠 → `isPathActive` 按段比较 →
> `activeNavPath` 取最长命中），本探针即该实现（`AppShell.tsx#isPathActive`）的常驻回归护栏。
> **2026-09-19 扩用（`9bm` / HOMEPAGE-005）**：用户要求「首页做成点击左上角网站标题访问，不要单独有一栏在
> 复盘分析下面」⇒ 侧栏「首页」导航项删除、`/` 的期望高亮从 `[首页]` 改为 **`[]`（零高亮）**，
> 并新增「标题按钮形态 = 首页入口」与「点题回首页」两组断言 —— 即**这个探针从此同时是「首页入口」的护栏**。

| 文件 | 结论要点 | 被引用于 |
|---|---|---|
| `_probe_sidebar_active_highlight.mjs` + `.out.txt` | ✅ **PASS 37 / FAIL 0 / SKIP 0 ⇒ ALL PASS**（`9bm` 后复跑；断言 32 → 37 条）。**1/6 导航路由 22 条**：逐条断言「侧栏恰好 1 项高亮且文案正确」（⚠️ 本轮同时纠正一处**过期断言** —— `/` 原先期望点亮「涨停复盘」，与 HOMEPAGE-001 之后的真实导航早已不符，本轮之前未复跑故未被发现 ⇒ 改为 `['/limit-up', '涨停复盘']`，并补登漏掉的 `/research/ask`）。**2/6 详情路由 5 条**：`/strategies/:id`、`/research/:id`、`/research/candidates/:id`、`/datasets/:id`、`/datasets/:id/versions` 均点亮**父项**。**3/6 反向断言 2 条**：`/backtest-runs` 不得点亮「组合回测」、`/backtest` 不得点亮「回测历史」。**4/6 点击流 4 条**：真实 `el.click()` 后比对 `location.pathname` + 高亮集合。**5/6 首页入口 3 条（本轮新增）**：站在 `/` 时侧栏**零高亮**（实测 `[]`）；侧栏 `[data-slot="sidebar-menu-button"]` 中**确无**「首页」项；`[data-slot="sidebar-home-link"]` 存在且 `text=涨停复盘助手` / `title=aria-label=返回首页` / `cursor=pointer`。**6/6 首页入口点击流 1 条（本轮新增）**：从 `/strategies` 点左上角标题 ⇒ `path=/` 且高亮 `[]`。 | `ROADMAP.md` §44 `9bm`、§44.5 `9bm`、`ROADMAP-CHANGELOG.md` 同名条目 |

> ⚠️ 坑一（本轮真踩，复用价值高）：**断言会「过期」，而代码没坏** —— 改完 `9bm` 首跑即报
> `FAIL / 期望唯一高亮=[涨停复盘] 实际=[]`；根因不是本轮改动，而是 `ROUTES` 里的 `/` 条目自 HOMEPAGE-001
> 起就已与产品事实不符（该探针当时未登记、未复跑，所以一直没人发现）。⇒ 断言失败先问
> 「**被断言的事实是否仍是当前产品事实**」，再去看代码。
> ⚠️ 坑二：**「路由」与「入口载体」是两件事** —— 删导航项**不必**动路由（`/` 仍指向 `Dashboard`），
> 但**必须同步**「站在该路由上侧栏该亮什么」的断言，否则会立刻假失败。
> ⚠️ 坑三（工具层，非探针）：**同一条消息里并行发两个 `Edit` 改同一文件 ⇒ 后写覆盖先写，前者静默丢失**
> （本轮 `ROUTES` 的 `/` → `/limit-up` 就被吞掉一次，靠复跑探针才发现）。改同一文件的多处修改**必须串行**。

| 文件 | 结论要点 | 被引用于 |
|---|---|---|
| `_shot_homepage_nav9bm.png` | 首页（`/`）整页截图，目视核对「侧栏『复盘分析』组已无『首页』项 + 左上角标题为首页入口」；内容高 **3290px**，与 `9bl` 完全一致 ⇒ 本轮只动入口、**未影响版式** | 同上（目视附件） |
