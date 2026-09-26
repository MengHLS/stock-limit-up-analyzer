# docs/INDEX.md —— 文档唯一入口

> **这是什么**：本仓库**全部有效文档**的唯一索引。找文档从这里开始，不要按目录名猜。
> **建立时间**：2026-09-21（分支 `cleanup/docs`）｜**维护方式**：新增/移动文档时同步本表一行。
> **它不替代**：`ROADMAP.md`（唯一 Master Control）、`README.MD`（启动说明）、`.workbuddy/memory/PROJECT_RULES.md`（工程铁律）。

---

## 0. 先读这三个（按顺序）

| # | 文档 | 作用 |
|---|---|---|
| 1 | [`README.MD`](../README.MD) | 启动 / 构建 / 测试命令，以及「不要跑 `prettier --write`」等硬禁令 |
| 2 | [`ROADMAP.md`](../ROADMAP.md) | **唯一 Master Control**（§44 覆盖式状态区 / §44.5 队列 / §47 append-only 记录） |
| 3 | [`docs/architecture/AGENT-GUIDE.md`](architecture/AGENT-GUIDE.md) | Agent 工作规范（§3 禁止行为、§5 CHANGE-AUDIT 要求） |

---

## 1. 项目级权威（仓库根）

| 文档 | 说明 |
|---|---|
| [`ROADMAP.md`](../ROADMAP.md) | 唯一 Master Control |
| [`ROADMAP-CHANGELOG.md`](../ROADMAP-CHANGELOG.md) | 变更日志 + §44 历史条目归档（**append-only，零改写**） |
| [`TASK_TRACKING.md`](../TASK_TRACKING.md) | 任务状态模型与任务清单（ROADMAP 引用的 §0.1 / §5） |
| [`DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md) | 工作量口径与计划（ROADMAP 引用的 §2） |
| [`AUDIT-DRS-001-EVIDENCE.md`](../AUDIT-DRS-001-EVIDENCE.md) | Strategy ⇄ Dataset Registry 联合审计证据（被 `SYSTEM-BASELINE.md` 引用） |
| [`README.MD`](../README.MD) | 快速上手 |

## 2. 架构基线 —— `docs/architecture/`

> 与代码同步维护的架构事实。改动代码前先读对应地图。

| 文档 | 说明 |
|---|---|
| [`SYSTEM-BASELINE.md`](architecture/SYSTEM-BASELINE.md) | **总基线**（其余地图的根） |
| [`SYSTEM-BASELINE-001-REPORT.md`](architecture/SYSTEM-BASELINE-001-REPORT.md) | 首版基线报告 |
| [`SYSTEM-BASELINE-002-REPORT.md`](architecture/SYSTEM-BASELINE-002-REPORT.md) | round-2 基线报告 |
| [`DOMAIN-MAP.md`](architecture/DOMAIN-MAP.md) | 领域地图 |
| [`DATABASE-MAP.md`](architecture/DATABASE-MAP.md) | 数据库域地图（**当前库结构权威**，2026-09-20 实查） |
| [`DATA-FLOW.md`](architecture/DATA-FLOW.md) | 数据流 |
| [`EXECUTION-FLOW.md`](architecture/EXECUTION-FLOW.md) | 执行流 |
| [`DEPENDENCY-MAP.md`](architecture/DEPENDENCY-MAP.md) | 依赖地图 |
| [`CONTRACT-MAP.md`](architecture/CONTRACT-MAP.md) | 契约地图 |
| [`CHANGE-AUDIT.md`](architecture/CHANGE-AUDIT.md) | 逐次变更审计（每个任务必记） |
| [`AGENT-GUIDE.md`](architecture/AGENT-GUIDE.md) | Agent 工作规范 |

## 3. 契约与 Gate 规范（`docs/` 根）

| 文档 | 说明 |
|---|---|
| [`quant-system-contract.md`](quant-system-contract.md) | 量化系统总契约（被 `SYSTEM-BASELINE.md` 与 `server/**` 源码引用） |
| [`RESEARCH_GATE_SPECIFICATION.md`](RESEARCH_GATE_SPECIFICATION.md) | 研究认证 Gate 规范 G0–G5（**ACTIVE**；被 `shared/dataHealthContracts.ts` 引用） |
| [`PRODUCT_GAP_MATRIX.md`](PRODUCT_GAP_MATRIX.md) | 产品缺口矩阵（被 `SYSTEM-BASELINE.md` 引用） |
| [`STEP_9_PORTFOLIO_ARCHITECTURE.md`](STEP_9_PORTFOLIO_ARCHITECTURE.md) | Portfolio 组合层边界契约（被 `server/portfolio/domain.ts` 引用） |
| [`step-dataset-002.2-report.md`](step-dataset-002.2-report.md) | Dataset Registry API / Shared Contract 交付报告（被测试文件引用） |

## 4. 审计 —— `docs/audit/`

| 文档 | 说明 |
|---|---|
| [`QUANT_MASTER_AUDIT_SPEC.md`](audit/QUANT_MASTER_AUDIT_SPEC.md) | 独立审计宪章（证据优先级、权限边界） |
| [`2026-09-09_AUDIT-002_FULL_SYSTEM_CODE_AUDIT_REPORT.md`](audit/reports/2026-09-09_AUDIT-002_FULL_SYSTEM_CODE_AUDIT_REPORT.md) | 全系统代码审计 |
| [`2026-09-17_AUDIT-004_REPO_HYGIENE_AUDIT_REPORT.md`](audit/reports/2026-09-17_AUDIT-004_REPO_HYGIENE_AUDIT_REPORT.md) | 仓库卫生审计与清理（**清理方法论的权威依据**） |

## 5. 测试资产 —— `docs/testing/`

> 由 `pnpm run docs:tests` 生成（`scripts/genTestDocs.mts`），**禁手改**。镜像 `tests/**` 结构。

| 入口 | 说明 |
|---|---|
| [`testing/README.md`](testing/README.md) | **测试总览**：全量基线、环境依赖失败集、三条命令、模块索引 |
| `testing/server/**/_index.md` | 按模块分册（`server/research` / `datasetRegistry` / `strategyCore` …） |
| `testing/client/src/**/_index.md` | 前端模块分册 |
| `testing/shared/_index.md` | 共享契约分册 |

## 6. 证据 —— `docs/evidence/`

| 入口 | 说明 |
|---|---|
| [`evidence/README.md`](evidence/README.md) | **证据总索引**（逐文件「被引用于」＋重跑方法；上文出现的裸 `_xxx` 一律指向本目录） |

`docs/evidence/` 内另有约 300 个 `_*.mts` / `_*.mjs` / `*.out.json` / `*.log` 探针与运行结果（不逐个列在本表）。
`docs/evidence/_report_body_630001.md` = Run #1 的研究报告**展示层投影**（生成物，唯一版本，就地保留）。

## 7. 认证程序（G0–G5 第一轮）—— `docs/quantRoadmap/`

| 入口 | 说明 |
|---|---|
| [`quantRoadmap/README.md`](quantRoadmap/README.md) | **任务索引**（11 个 P1/P2/P3 任务的 Gate / 状态 / 日期 / 证据路径） |
| [`quantRoadmap/reports/research-dataset-policies.md`](quantRoadmap/reports/research-dataset-policies.md) | **FROZEN**：9 项 dataset policy 权威口径 |
| [`quantRoadmap/reports/industry-historical-coverage.md`](quantRoadmap/reports/industry-historical-coverage.md) | Industry 历史覆盖报告 |

## 8. 研究交付 —— `docs/research/`

### 8.1 研究核心链路
[`RESEARCH-001-AUDIT.md`](research/RESEARCH-001-AUDIT.md)｜[`RESEARCH-001-SCHEMA.md`](research/RESEARCH-001-SCHEMA.md)｜[`RESEARCH-001-report.md`](research/RESEARCH-001-report.md)｜[`RESEARCH-002-report.md`](research/RESEARCH-002-report.md)｜[`RESEARCH-010-implementation.md`](research/RESEARCH-010-implementation.md)｜[`LAYER_CONVENTIONS.md`](research/LAYER_CONVENTIONS.md)

### 8.2 研究 → 策略桥 / Pattern
[`RESEARCH-006.0-architecture.md`](research/RESEARCH-006.0-architecture.md)｜[`RESEARCH-006.1`](research/RESEARCH-006.1-implementation.md)～[`RESEARCH-006.4.1-B`](research/RESEARCH-006.4.1-B-implementation.md)｜[`RESEARCH-STRATEGY-BRIDGE-implementation.md`](research/RESEARCH-STRATEGY-BRIDGE-implementation.md)｜[`RESEARCH-STRATEGY-GAP-AUDIT-001.md`](research/RESEARCH-STRATEGY-GAP-AUDIT-001.md)｜[`PATTERN-LIBRARY-001-implementation.md`](research/PATTERN-LIBRARY-001-implementation.md)｜[`RESEARCH-PATTERN-LOOP-AUDIT-001.md`](research/RESEARCH-PATTERN-LOOP-AUDIT-001.md)｜[`BRIDGE-CONDITION-EXPRESSION-001-implementation.md`](research/BRIDGE-CONDITION-EXPRESSION-001-implementation.md)

### 8.3 FINDING / PLANNER / 桥接增量
[`RESEARCH-FINDING-001-audit.md`](research/RESEARCH-FINDING-001-audit.md)｜[`RESEARCH-FINDING-001-implementation.md`](research/RESEARCH-FINDING-001-implementation.md)｜[`RESEARCH-PLANNER-001-implementation.md`](research/RESEARCH-PLANNER-001-implementation.md)｜[`RESEARCH-PLANNER-001-defect-780001.md`](research/RESEARCH-PLANNER-001-defect-780001.md)｜[`STEP-0-RESEARCH-ORPHAN-RECLAIM-001-implementation.md`](research/STEP-0-RESEARCH-ORPHAN-RECLAIM-001-implementation.md)｜[`STEP-A-DECLARATIVE-CONDITIONS-implementation.md`](research/STEP-A-DECLARATIVE-CONDITIONS-implementation.md)｜[`STEP-B-EVALUATION-PORT-implementation.md`](research/STEP-B-EVALUATION-PORT-implementation.md)

### 8.4 回测 / 验证域
[`BACKTEST-001-IMPLEMENTATION-REPORT.md`](research/BACKTEST-001-IMPLEMENTATION-REPORT.md)｜[`BACKTEST-002-IMPLEMENTATION-REPORT.md`](research/BACKTEST-002-IMPLEMENTATION-REPORT.md)｜[`OOS-001-implementation.md`](research/OOS-001-implementation.md)｜[`WALK-FORWARD-001-implementation.md`](research/WALK-FORWARD-001-implementation.md)｜[`ROBUSTNESS-CROSS-STAGE-001.md`](research/ROBUSTNESS-CROSS-STAGE-001.md)｜[`STOPLOSS-PARITY-AUDIT-001.md`](research/STOPLOSS-PARITY-AUDIT-001.md)

### 8.5 研究阶段（PHASE-* / 9cc）
[`9cc-implementation.md`](research/9cc-implementation.md)｜[`PHASE-A-REPORT-ARTIFACT-001.md`](research/PHASE-A-REPORT-ARTIFACT-001.md)｜[`PHASE-B-001-implementation.md`](research/PHASE-B-001-implementation.md)｜[`PHASE-D-001-implementation.md`](research/PHASE-D-001-implementation.md)｜[`PHASE-R1-001-implementation.md`](research/PHASE-R1-001-implementation.md)｜[`RESEARCH-007.1-pullback-correction.md`](research/RESEARCH-007.1-pullback-correction.md)｜[`RESEARCH-007.2-research-matrix-view.md`](research/RESEARCH-007.2-research-matrix-view.md)｜[`RESEARCH-007.3-run-540001-coverage-backfill.md`](research/RESEARCH-007.3-run-540001-coverage-backfill.md)

### 8.6 前端产品化
[`FRONTEND-FINAL-001-AUDIT.md`](research/FRONTEND-FINAL-001-AUDIT.md)｜[`FRONTEND-FINAL-001-REPORT.md`](research/FRONTEND-FINAL-001-REPORT.md)｜[`LEADER-CANDIDATE-LOADFAIL-DIAG-001.md`](research/LEADER-CANDIDATE-LOADFAIL-DIAG-001.md)

### 8.7 独立研究实验体系（规范与实施）
[`EXPERIMENT-CODE-SPEC.md`](research/EXPERIMENT-CODE-SPEC.md)（**A~P 契约全文**）｜[`FIRST-BOARD-PULLBACK-COVERAGE-AUDIT.md`](research/FIRST-BOARD-PULLBACK-COVERAGE-AUDIT.md)（**分组与退出口径审计**）｜[`FIRST-BOARD-PULLBACK-EXIT-PROTOCOL-V1.md`](research/FIRST-BOARD-PULLBACK-EXIT-PROTOCOL-V1.md)（**FROZEN 退出协议 V1**）｜[`FIRST-BOARD-PULLBACK-EXIT-PROTOCOL-V2.md`](research/FIRST-BOARD-PULLBACK-EXIT-PROTOCOL-V2.md)（**FROZEN 涨跌停过滤 V2**）｜[`FIRST-BOARD-PULLBACK-FOUNDATION-V1.md`](research/FIRST-BOARD-PULLBACK-FOUNDATION-V1.md)（**公共研究底座**）｜[`RESEARCH-EXPERIMENT-001-final.md`](research/RESEARCH-EXPERIMENT-001-final.md)｜[`RESEARCH-EXPERIMENT-002-final.md`](research/RESEARCH-EXPERIMENT-002-final.md)｜[`RESEARCH-EXPERIMENT-003-final.md`](research/RESEARCH-EXPERIMENT-003-final.md)｜[`RESEARCH-EXPERIMENT-004-final.md`](research/RESEARCH-EXPERIMENT-004-final.md)

### 8.8 实验产出（EXP）
[`EXP-001-final.md`](research/EXP-001-final.md)｜[`EXP-002-REPORT.md`](research/EXP-002-REPORT.md)

### 8.9 策略架构
[`STRATEGY-AUDIT-001.md`](research/STRATEGY-AUDIT-001.md)｜[`STRATEGY-ARCH-001-IMPLEMENTATION-MAP.md`](research/STRATEGY-ARCH-001-IMPLEMENTATION-MAP.md)｜[`STRATEGY-ARCH-001-IMPLEMENTATION-REPORT.md`](research/STRATEGY-ARCH-001-IMPLEMENTATION-REPORT.md)｜[`STRATEGY-ARCH-002-IMPLEMENTATION-REPORT.md`](research/STRATEGY-ARCH-002-IMPLEMENTATION-REPORT.md)｜[`STRATEGY-SPEC-first-limit-pullback.md`](research/STRATEGY-SPEC-first-limit-pullback.md)

### 8.10 策略模块扩展（001 与修订版，**两份都留**）
[`PLAN-STRATEGY-MODULE-EXTENSION-001.md`](research/PLAN-STRATEGY-MODULE-EXTENSION-001.md)（事实 + 「无目录扫描」约定出处，被 `server/researchExperiments/registry.ts:7` 引用）｜[`PLAN-STRATEGY-MODULE-EXTENSION-001-REVISED.md`](research/PLAN-STRATEGY-MODULE-EXTENSION-001-REVISED.md)（取代 001 的分期，最新）

## 9. 数据集 / 策略 / 参数 / 稳健性

| 目录 | 文档 |
|---|---|
| `docs/researchDataset/` | [`DATASET_SPECIFICATION.md`](researchDataset/DATASET_SPECIFICATION.md)｜[`DATASET_CERTIFICATION_SPEC.md`](researchDataset/DATASET_CERTIFICATION_SPEC.md)｜[`DATASET_VERSIONING.md`](researchDataset/DATASET_VERSIONING.md)｜[`DATASET_CAPABILITY_MATRIX.md`](researchDataset/DATASET_CAPABILITY_MATRIX.md)｜[`DATASET_CURRENT_STATE_AUDIT.md`](researchDataset/DATASET_CURRENT_STATE_AUDIT.md)｜[`RESEARCH_DATASET_V2_IMPLEMENTATION_REPORT.md`](researchDataset/RESEARCH_DATASET_V2_IMPLEMENTATION_REPORT.md) |
| `docs/strategy/` | [`STRATEGY-003-report.md`](strategy/STRATEGY-003-report.md)｜[`STRATEGY-003-difference-report.md`](strategy/STRATEGY-003-difference-report.md)｜[`STRATEGY-004-report.md`](strategy/STRATEGY-004-report.md)｜[`STRATEGY-RESEARCH-BRIDGE-001-REPORT.md`](strategy/STRATEGY-RESEARCH-BRIDGE-001-REPORT.md) |
| `docs/parameter-search/` | [`PARAMETER-001-REPORT.md`](parameter-search/PARAMETER-001-REPORT.md)｜[`PARAMETER-002-REPORT.md`](parameter-search/PARAMETER-002-REPORT.md) |
| `docs/parameter/` | [`PARAMETER-001-PRE-PROFILE.md`](parameter/PARAMETER-001-PRE-PROFILE.md) |
| `docs/robustness/` | [`ROBUSTNESS-001-REPORT.md`](robustness/ROBUSTNESS-001-REPORT.md) |

## 10. 独立研究实验（作者面）—— `research-experiments/`

| 文档 | 说明 |
|---|---|
| [`research-experiments/README.md`](../research-experiments/README.md) | **实验体系总说明**（四条硬约束、新增实验两步、Robustness 唯一引桥） |
| [`first-board-pullback/entry-day/README.md`](../research-experiments/first-board-pullback/entry-day/README.md) | 完整可运行示例 |
| [`first-board-pullback/fundamental-study/README.md`](../research-experiments/first-board-pullback/fundamental-study/README.md) | EXP-001（`9cj`） |
| [`first-board-pullback/stability-validation/README.md`](../research-experiments/first-board-pullback/stability-validation/README.md) | EXP-002（`9cl`） |
| [`template/README.md`](../research-experiments/template/README.md) | 新实验模板 |
| [`PLAN-MARKET-LEADER-REVERSAL-001.md`](research/PLAN-MARKET-LEADER-REVERSAL-001.md) | 市场总龙生命周期与断板反抽研究计划（Phase 0 已通过） |

## 11. 归档区

| 目录 | 说明 |
|---|---|
| [`archive/README.md`](archive/README.md) | **本次（2026-09-21）归档**：21 份过期 plan / roadmap / todo / 阶段审计与设计快照，含原路径对照表 |
| [`legacy/README.md`](legacy/README.md) | 2026-09-13 归档：仓库根目录的 14 个非 `_*` 文件 |
| [`legacy/phase-reports/README.md`](legacy/phase-reports/README.md) | 2026-09-17 归档：`docs/` 根目录的 59 份历史阶段报告（含 PHASE1 STEP2~5 的审计-修复轮次链） |

> ⚠️ `docs/legacy/` 与 `docs/archive/` **同为归档区**，`legacy/` 未搬迁的原因见 `archive/README.md` §4。

## 12. 过程记忆（不在本仓版本库内）

| 路径 | 说明 |
|---|---|
| `.workbuddy/memory/PROJECT_RULES.md` | 工程铁律与已知地雷（**动手前必读**） |
| `.workbuddy/memory/MEMORY.md` | 项目长期约定（跨会话） |
| `.workbuddy/memory/YYYY-MM-DD.md` | 逐日工作日志（append-only） |

> 自 2026-09-19 起 `.workbuddy/` 已 untrack + gitignore ⇒ **只存在于本机**。

---

## 13. 本次清理（2026-09-21 · 分支 `cleanup/docs`）摘要

- **删除**：**0 份**。判据（全部落盘可复查）：256 份在范围内 md 中无规范化后字节级重复、无包含关系、无标题集 Jaccard ≥ 0.6 的对；3 份「全库零引用」经复核属「过期」或「待裁定」⇒ 按归档规则处理（见 `archive/README.md` §1 R4）。
- **归档**：**20 份** → `docs/archive/`（逐条原因见 `archive/README.md` §2）。另有 1 份（`PLAN-STRATEGY-MODULE-EXTENSION-001.md`）**计划归档但执行期复核后原地保留** —— 它被生产源码注释引用（见 `archive/README.md` §2.1）。
- **合并**：新增 `docs/quantRoadmap/README.md` 作为 G0–G5 程序的任务级索引（11 份 `acceptance.md` **未删除** —— 其目录布局是 `docs/RESEARCH_GATE_SPECIFICATION.md` §证据目录约定 的强制约定）。
- **效果**：`docs/` 根目录 md **20 → 6**（5 保留 + 本文件）；`docs/research/` **57 → 55**；新增 3 份索引（本文件 / `archive/README.md` / `quantRoadmap/README.md`）⇒ 全仓 md（不含 `.workbuddy/`）**256 → 259**。
- **可回滚**：本轮全部为 `git mv`（记为 `R`）⇒ `git checkout main -- docs/` 可整体还原。
