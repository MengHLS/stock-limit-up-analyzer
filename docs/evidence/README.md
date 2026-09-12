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
