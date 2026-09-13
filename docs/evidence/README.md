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

