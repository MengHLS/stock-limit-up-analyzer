# `docs/archive/` —— 过期文档归档区（2026-09-21）

> **这是什么**：2026-09-21 文档清理（分支 `cleanup/docs`）把 **20 份已过期 / 被取代 / 待裁定的文档**从
> `docs/` 根目录、`docs/audit/`、`docs/research/`、`docs/researchDataset/` 归入本目录。
> **全部是 `git mv`（移动，零删除）** ⇒ 可用 `git checkout main -- docs/` 一键整体还原。
>
> **入口**：`docs/INDEX.md` §11。

---

## 1. 归档判据（本次使用的四条）

| 判据 | 含义 |
|---|---|
| **R1 被取代** | 文档自述「取代 X」而实际已被别的文档取代，或其后继文档明确宣布作废其结论 |
| **R2 过期快照** | 某时点的现状/验收快照，其结论已被后续实查推翻或已完成 |
| **R3 未实施 plan** | 明确标注「待批准 / 未实施」且长期未启动的方案 |
| **R4 零引用证据** | 全库无任何 md 引用，但内容属审计/验收证据（**不删，归档**） |

> 🔴 **为什么不删**：本仓库的既有约定是「证据 = 真实 DB > 运行结果 > 代码 > 测试 > 文档 > 假设」
> （`docs/audit/reports/2026-09-17_AUDIT-004_REPO_HYGIENE_AUDIT_REPORT.md` §1 已确立「按引用关系而非文件类别」
> 且**零删除**的清理方法论）。这 21 份里含真实指纹、行数、审计结论 ⇒ 归入归档区而非删除。

---

## 2. 清单（20 项 · 原路径 → 归档后路径）

| # | 原路径 | 归档后 | 判据 | 原因 |
|---|---|---|---|---|
| 1 | `docs/MASTER_PRODUCT_ROADMAP.md` | `archive/MASTER_PRODUCT_ROADMAP.md` | R1 | 自述「取代 `ROADMAP.md` §44-47 的跟踪职责」，但项目铁律规定 `ROADMAP.md` 是**唯一** Master Control ⇒ 该取代从未生效，文件自 2026-09-09 起未再更新 |
| 2 | `docs/MASTER_TASK_TRACKING.md` | `archive/MASTER_TASK_TRACKING.md` | R1 | 同上（自述取代 `TASK_TRACKING.md`，而 `ROADMAP.md` 引用的仍是后者） |
| 3 | `docs/FINAL_PRODUCT_ACCEPTANCE_CRITERIA.md` | `archive/FINAL_PRODUCT_ACCEPTANCE_CRITERIA.md` | R2 | 2026-09-09 的 Q1–Q20 验收快照；当时 Q11/Q14/Q15/Q16 = `NO`，此后已实现（OOS/Walk-Forward/策略 verdict/回测留档均已落地） |
| 4 | `docs/DATABASE_DESIGN.md` | `archive/DATABASE_DESIGN.md` | R2 | 2026-09-10 的库结构实查快照；当前库结构权威已由 `docs/architecture/DATABASE-MAP.md`（v2.0.0 / 2026-09-20 实查）承担 |
| 5 | `docs/DATABASE_REDESIGN.md` | `archive/DATABASE_REDESIGN.md` | R2 | 同批的重构方案；自述 S1~S4 已实施（2026-09-10 20:15），方案使命已完成 |
| 6 | `docs/PHASE0_SOURCE_CODE_AUDIT_REPORT.md` | `archive/PHASE0_SOURCE_CODE_AUDIT_REPORT.md` | R2 | 2026-09-05 的 Phase 0 只读审计（给当时系统打 4.5/10）；结论已被后续 10+ 轮交付超越 |
| 7 | `docs/PHASE1_STEP4_AUDIT_REPORT.md` | `archive/PHASE1_STEP4_AUDIT_REPORT.md` | R2 | PHASE1 STEP4 审计轮的 docs/ 根残留（同类 59 份已于 2026-09-17 归入 `docs/legacy/phase-reports/`） |
| 8 | `docs/PHASE1_STEP4_DEVELOPMENT_REPORT.md` | `archive/PHASE1_STEP4_DEVELOPMENT_REPORT.md` | R2 | 同上（开发轮） |
| 9 | `docs/PHASE1_STEP4_FIX_REPORT.md` | `archive/PHASE1_STEP4_FIX_REPORT.md` | R2 | 同上（修复轮） |
| 10 | `docs/PHASE1_STEP5_AUDIT_REPORT.md` | `archive/PHASE1_STEP5_AUDIT_REPORT.md` | R2 | STEP5 审计轮残留；同轮次的 5 份已在 `docs/legacy/phase-reports/`（见 §3） |
| 11 | `docs/STEP5_FINAL_FULL_SYSTEM_INDEPENDENT_AUDIT_REPORT.md` | `archive/STEP5_FINAL_FULL_SYSTEM_INDEPENDENT_AUDIT_REPORT.md` | R2 | STEP5 轮次链的**最终轮**（自述不采信此前所有 STEP1–5 与 re-audit 结论）⇒ 与 §10 互为同一链条 |
| 12 | `docs/STEP_7.3_IMPLEMENTATION_REPORT.md` | `archive/STEP_7.3_IMPLEMENTATION_REPORT.md` | R2 | STEP 7.3 的 docs/ 根残留（同 STEP 的另外 2 份已在 `docs/legacy/phase-reports/`） |
| 13 | `docs/STEP_7.3_MIGRATION_DRIFT_REPORT.md` | `archive/STEP_7.3_MIGRATION_DRIFT_REPORT.md` | R2 | 同上（迁移编号漂移报告，该漂移早已处置完毕） |
| 14 | `docs/FRONTEND_CURRENT_STATE_AUDIT.md` | `archive/FRONTEND_CURRENT_STATE_AUDIT.md` | R1 | 2026-09-07 前端现状审计；已被 `docs/research/FRONTEND-FINAL-001-AUDIT.md`（2026-09-20）+ `-REPORT.md` 取代 |
| 15 | `docs/PERF-DIAG-001_research_assembly.md` | `archive/PERF-DIAG-001_research_assembly.md` | R2 | 2026-09-12 性能诊断；其替代 `PERF-IMPL-001` 与后续性能方案均已归档/已实施 |
| 16 | `docs/audit/reports/2026-09-06_AUDIT-001_QUANT_MASTER_AUDIT_REPORT.md` | `archive/2026-09-06_AUDIT-001_QUANT_MASTER_AUDIT_REPORT.md` | R4 | 首次 QUANT MASTER 审计（`RESEARCH_READY=FALSE` / 3 项 HIGH）；**全库零引用**，且已被 AUDIT-002 / AUDIT-004 接续 |
| 17 | `docs/research/PLAN-research-to-strategy-condition.md` | `archive/PLAN-research-to-strategy-condition.md` | R1 | 2026-09-13「研究测算条件 → 策略条件」方案；其中 3 处缺口已由 `STEP-A-DECLARATIVE-CONDITIONS-implementation.md` / `BRIDGE-CONDITION-EXPRESSION-001-implementation.md` 落地 |
| 18 | `docs/research/PLAN-BACKTEST-COLD-START-001.md` | `archive/PLAN-BACKTEST-COLD-START-001.md` | R3 | 2026-09-19 组合回测冷启动方案，自述「待用户确认，尚未实施」；后续性能工作已另行推进 |
| 19 | `docs/researchDataset/DATASET_V2_IMPLEMENTATION_PLAN.md` | `archive/DATASET_V2_IMPLEMENTATION_PLAN.md` | R3 | 2026-09-09 数据集 V2 实施计划，自述「待确认，未进入代码修改」+ §0 列 7 项决策「需用户确认」；**全库零引用** |
| 20 | `docs/step-dataset-002/DATASET-002-AUDIT-FINAL.md` | `archive/DATASET-002-AUDIT-FINAL.md` | R4 | DATASET-002 系列审计；**全库零引用**，其兄弟 `step-dataset-002.2-report.md` 因被测试文件引用而留在原处 ⇒ 单件归档（`docs/step-dataset-002/` 目录随之清空并删除） |

### 2.1 一条「计划归档但最终原地保留」的（重要先例）

`docs/research/PLAN-STRATEGY-MODULE-EXTENSION-001.md`（R1 被取代）**最终未归档**，原因是执行期的引用复核发现：

```
server/researchExperiments/registry.ts:7
 * （`docs/research/PLAN-STRATEGY-MODULE-EXTENSION-001.md`；先例 = `server/patternLibrary/patterns/index.ts` …）
```

它被**生产源码的注释当作「无目录扫描 / 无 codegen」这条现行约定的出处引用** ⇒ 搬走它就得改 `server/**`
（会触发热重启并可能杀死在途研究 Run）⇒ 按本仓既有先例（`calibrate_open_expectation.ts` 同理留根目录）
**原地保留**；同时 `docs/research/PLAN-STRATEGY-MODULE-EXTENSION-001-REVISED.md` 对它的引用也继续有效。
⇒ 这两份的关系是「001 提供事实与约定出处，REVISED 取代其分期」，**都留**。

---

## 3. 「同一轮次链」的说明（避免误读为丢失）

归档后 `PHASE1 STEP2/3/4/5` 与 `STEP 7.3` 的轮次报告**分散在两处**，这不是丢失，而是两次清理的时间差：

| 轮次链 | `docs/legacy/phase-reports/`（2026-09-17 归位） | `docs/archive/`（本次） |
|---|---|---|
| PHASE1 STEP2 | `PHASE1_STEP2_{ACCEPTANCE,FINAL_AUDIT,FIX,REAUDIT}_REPORT.md`（4） | — |
| PHASE1 STEP3 | `PHASE1_STEP3_{ACCEPTANCE,DEVELOPMENT}_REPORT.md`（2） | — |
| PHASE1 STEP4 | `PHASE1_STEP4_REAUDIT_REPORT.md`（1） | `PHASE1_STEP4_{AUDIT,DEVELOPMENT,FIX}_REPORT.md`（3） |
| PHASE1 STEP5 | `PHASE1_STEP5_{DEVELOPMENT,FIX,FIX2,REAUDIT_REPORT_2,REAUDIT_REPORT_3}.md`（5） | `PHASE1_STEP5_AUDIT_REPORT.md` + `STEP5_FINAL_FULL_SYSTEM_INDEPENDENT_AUDIT_REPORT.md`（2） |
| STEP 7.3 | `STEP_7.3_{BACKFILL_COVERAGE,DATA_INTEGRITY}_REPORT.md`（2） | `STEP_7.3_{IMPLEMENTATION,MIGRATION_DRIFT}_REPORT.md`（2） |

> 2026-09-17 的那次归位**刻意留下**了「被 `docs/**` 引用的那几份」（见 `docs/legacy/phase-reports/README.md`
> 的归位判据），本次清理把余下的 docs/ 根残留一并归档 ⇒ 两类文档现在**都在归档区**，只是子目录不同。

## 4. 为什么 `docs/legacy/` 没有被合并进本目录

`docs/legacy/`（70 份，2026-09-13 + 2026-09-17 两次归位）与本目录**语义相同**（都是「过期但保留」），
但本次**未**把它搬进 `docs/archive/`，理由三条：

1. **会被 append-only 记录逐条提及** —— `ROADMAP-CHANGELOG.md` 与 `.workbuddy/memory/**.md` 是本仓的
   append-only 记录（`PROJECT_RULES.md`「历史条目零改写」），搬迁会在其中留下上百条无法回溯的悬空路径，
   而这两个文件**禁止改写**。
2. **它自带完整索引** —— `docs/legacy/README.md`（14 项）+ `docs/legacy/phase-reports/README.md`（59 项）
   已逐文件列出「原路径 → 归位后路径」，搬迁需要同步重写这两份索引。
3. **导航收益为零** —— 归档区本就不参与日常检索，合并只减少一个目录名。

⇒ 判定**收益为负，未执行**。若后续要统一，建议单独排期并同步改 `ROADMAP.md` + 两份 legacy README
（`ROADMAP-CHANGELOG.md` 与 memory 日志只能追加一句「上文 `docs/legacy/**` 已于 X 日改为 `docs/archive/legacy/**`」）。

## 5. 未归档但同样过期、因此留待裁定的项

| 文档 | 情况 |
|---|---|
| `docs/research/RESEARCH-001-report.md` | 只被 `ROADMAP-CHANGELOG.md` 提及；与其 AUDIT / SCHEMA 两份（被 `docs/architecture/` 引用）属同一交付 ⇒ 拆开归档会断开一组内聚证据，**保留原处** |
| `docs/research/PLAN-STRATEGY-MODULE-EXTENSION-001-REVISED.md` | 修订版自身仍是最新方案（其取代的对象 `/PLAN-STRATEGY-MODULE-EXTENSION-001.md` 因被源码注释引用而原地保留）⇒ **保留** |
| `docs/legacy/phase-reports/PHASE1_STEP*` 轮次链（约 15 份） | 属「同口径重跑的多个 Run」形态，理论上可合并为 1 份索引；但它们**已在归档区**、已被归档索引逐条登记 ⇒ 二次合并只减少已归档文件数（详见 §4） |
| `docs/quantRoadmap/evidence/**/acceptance.md`（11 份） | 属**不同**任务（P1-T1…P3-T4 ≠ 同口径重跑）；且其目录布局是 `docs/RESEARCH_GATE_SPECIFICATION.md` §证据目录约定 的**强制约定** ⇒ 不合并、不删除（已另建 `docs/quantRoadmap/README.md` 作为索引） |

### 5.1 归档造成的引用残留（如实登记，未单方面改写他人记录）

下列位置仍按**旧路径**提到已归档文档。**均为刻意保留**，不构成断链（`git` 中的原路径仍可检出）：

| 提及位置 | 提及对象 | 为什么不改 |
|---|---|---|
| `ROADMAP-CHANGELOG.md` | `DATABASE_DESIGN` / `DATABASE_REDESIGN` / `PERF-DIAG-001` / `PLAN-research-to-strategy-condition` | **append-only**，`PROJECT_RULES.md` 明令「历史条目零改写」 |
| `.workbuddy/memory/**` | 同上 + `PLAN-STRATEGY-MODULE-EXTENSION-001` / `PLAN-BACKTEST-COLD-START-001` | 本地过程记忆，append-only，且 `.workbuddy/` 已 untrack |
| `docs/legacy/**`（归档区内部） | `MASTER_*` / `FINAL_PRODUCT_ACCEPTANCE_CRITERIA` / `PHASE0` / `PHASE1_STEP4_*` / `PHASE1_STEP5_AUDIT` / `STEP5_FINAL` / `STEP_7.3_IMPLEMENTATION` / `FRONTEND_CURRENT_STATE_AUDIT` / `PERF-DIAG-001` | 归档文本是**历史陈述**（「当时引用了什么」），改写它会篡改历史 |
| `docs/audit/reports/2026-09-17_AUDIT-004_REPO_HYGIENE_AUDIT_REPORT.md` | `PHASE1_STEP4_AUDIT_REPORT.md` | 2026-09-17 的**时点审计快照**，记录的是「该文件当年被引用因此未归位」这一事实；本次清理已改变该事实 ⇒ 见本目录 §2 与 `docs/INDEX.md` |
| `docs/researchDataset/DATASET_CURRENT_STATE_AUDIT.md` | `MASTER_*` / `DATASET_V2_IMPLEMENTATION_PLAN` | 该审计 §1「审计方法」列的是**当时**读过的文档清单 |
| `docs/evidence/README.md` | `PLAN-research-to-strategy-condition` | 证据总索引的「被引用于」列属自动元数据，非权威引用 |

> ⇒ 需要「当前有效路径」时**一律以 `docs/INDEX.md` 为准**，不要相信其它文档里的裸路径。

---

## 6. 回滚

```bash
# 整体还原（本目录全部为 git mv，记录为 R）
git checkout main -- docs/

# 单份还原
git checkout main -- docs/DATABASE_DESIGN.md
```
