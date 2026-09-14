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
