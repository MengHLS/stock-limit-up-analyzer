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

> 🔴 **2026-10-03 起**：新增 [`AGENTS.md`](../AGENTS.md) 作为**项目级 Agent 总规则**（规则与边界；优先级高于本表顺序）；新增 `docs/architecture/ARCHITECTURE.md` / `MODULE-MAP.md` / `LEGACY-MAP.md` 作为**当前实际架构**读数（见下 §2）。

---

## 1. 项目级权威（仓库根）

| 文档 | 说明 |
|---|---|
| [`ROADMAP.md`](../ROADMAP.md) | 唯一 Master Control |
| [`ROADMAP-CHANGELOG.md`](../ROADMAP-CHANGELOG.md) | 变更日志 + §44 历史条目归档（**append-only，零改写**） |
| [`TASK_TRACKING.md`](../TASK_TRACKING.md) | 任务状态模型与任务清单（ROADMAP 引用的 §0.1 / §5） |
| [`DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md) | 工作量口径与计划（ROADMAP 引用的 §2） |
| [`AUDIT-DRS-001-EVIDENCE.md`](../AUDIT-DRS-001-EVIDENCE.md) | Strategy ⇄ Dataset Registry 联合审计证据（被 `SYSTEM-BASELINE.md` 引用） |
| [`AGENTS.md`](../AGENTS.md) | **项目级 Agent 总规则**（规则与边界；CODE-AGENT-INFRA-001，2026-10-03）。动手前先读本文件，再读架构基线 |
| [`README.MD`](../README.MD) | 快速上手 |

## 2. 架构基线 —— `docs/architecture/`

> 与代码同步维护的架构事实。改动代码前先读对应地图。

| 文档 | 说明 |
|---|---|
| [`SYSTEM-BASELINE.md`](architecture/SYSTEM-BASELINE.md) | **总基线**（其余地图的根） |
| [`ARCHITECTURE.md`](architecture/ARCHITECTURE.md) | **当前实际架构**（CODE-AGENT-INFRA-001，2026-10-03 实查；含与 v2.0.0 基线的 drift 登记） |
| [`MODULE-MAP.md`](architecture/MODULE-MAP.md) | **模块地图**（Module / Purpose / Main Entry / Dependencies / Consumers / Tests / Status） |
| [`LEGACY-MAP.md`](architecture/LEGACY-MAP.md) | **legacy 路径地图**（Legacy Path / Current Consumer / Replacement / Migration Status / Risk） |
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
| [`SCOPE-002-strategy-authoring-workbench.md`](architecture/SCOPE-002-strategy-authoring-workbench.md) | **策略创作工作台设计**（**DECIDED · 六项已裁定**：数据结构 + API 契约 + 前端交互 + 代码计划；目标 = 纯前端构建 Strategy `3570001`；空白 canonical 起点 · 预设+参数 · 允许无证据 Draft；未实现、不改契约/DB） |
| [`FE-PLAN-003-strategy-definition-restructure.md`](product/FE-PLAN-003-strategy-definition-restructure.md) | **「策略定义」页设计方案 v2**（PROPOSED）：**每块 = 方案 + 参数 + 信任状态**；**二次裁定已定**——「执行层零实现的字段（`risk.*` / `maxExposure` / `maxSinglePosition`）**删除编辑面**（schema 保留，技术细节只读）、账户风控默认不启用、`maxPositions` **来源收敛**（实测零冲突）；附四层普查表、真实库分布（`risk` 仅 3/176 且为模板值）、15 条交互规格 |
| [`FE-PLAN-004-exit-policy-restructure.md`](product/FE-PLAN-004-exit-policy-restructure.md) | **「退出政策」拆解为规则槽**（PROPOSED，只出方案不改代码）：实测 **46 个实验 = 6 个正交规则槽的单变量扫描**（40 个只改 1 维、4 个改 2 维、**2 个与基准逐字相同**）；结论 **出场 = 6 槽（止损位置 / 止损确认 / 止损收紧 / 止损节奏 / 止盈 / 到期与续持）+ 研究槽**，46 个实验降级为只读实验档案；并查出 **`stop.contexts` 与 `capitalRecycle` 两个假旋钮**（声明+校验齐全、**全仓零执行**） |
| [`FE-PLAN-005-single-strategy-page-convergence.md`](product/FE-PLAN-005-single-strategy-page-convergence.md) | **单策略专项页收敛（3570001 → 通用策略详情 Tab）**（**IMPLEMENTED**）：侧栏删除「最终评估 3570001（专项）」「模拟盘 3570001（专项）」两项（④ 7→6、⑥ 3→2，**侧栏不再出现任何策略坐标**）；两条旧路径改为静态改写到 `/strategies/<坐标>?version=…&tab=evaluation\|paper`；策略详情新增 `?tab=` 深链（白名单 + `replace` 写回 URL）；两个专项页文件删除 ⇒ 留档展示入口唯一；**0 契约 / 0 DB / 0 执行链变化** |
| [`FE-PLAN-006-empty-error-state-coverage.md`](product/FE-PLAN-006-empty-error-state-coverage.md) | **空态 / 错误态覆盖（前端诚实三态）**（**DONE**）：全站扫描 `client/src/pages/**` **32 个带取数页面三态齐全（缺口 0）**；修 **2 处**「读取失败被伪装成空数据」——`ReviewWorkbench`（列表/详情此前**无任何 error 分支**，改走共享 `ErrorState`）与 `PaperTrading`（运行列表/详情）；用 **CDP Fetch 域把请求打成失败**做真实渲染验证（2/2：错误态出现、空态未误显示）；另 **4 页解构式主查询缺口**登记为 backlog（Market / LimitUpReview / SentimentAlerts / Backtest） |
| [`FE-PLAN-007-table-sorting-pagination-triage.md`](product/FE-PLAN-007-table-sorting-pagination-triage.md) | **表格「排序 / 分页」语义分类登记**（**DONE，只分类不改行为**）：全站 **29 个含表格文件**（数据表 23 / 非数据表 6）扫描后确认 —— **没有任何一处是服务端分页**，所有翻页都是「服务端 `limit` 截断 + 客户端展示」，排序一律是客户端 `useMemo().sort()`；结论**维持现状**（引入服务端分页/排序属契约变更），并登记 4 张「域内全量表」与 2 个高密度客户端排序页的规模风险点 |
| [`FE-PLAN-008-strategy-domain-pages-optimization.md`](product/FE-PLAN-008-strategy-domain-pages-optimization.md) | **④「策略」域页面优化方案**（**PROPOSED · 只出计划不改代码**）：实测盘点 8 个入口的 URL 坐标覆盖（参数搜索最全；**绩效仪表盘无任何坐标**；回测历史/对比仅 `strategyId` 无 version）；**P0-1** 模拟盘留档 3 张表把 `securityId`（`sec_<uuid>…`）当「股票」列印 ⇒ 复用既有 `useSecurityLabels` + 失败回退原始 id（复用 `ClosedLoopRunResultPanel` 已成型的解法）；**P0-2** 策略域坐标贯通；**P1-1** `Draft` 徽章语义 + `strategyListAdapter` 缺省值冒充 `Draft`；含 3 条 NEEDS_HUMAN（绩效仪表盘定位 / 缺省状态 / 运行回测出口）与 5 步可单验收顺序 |

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

[首板滚动观察池与每日右尾识别：最小研究闭环目标](research/GOAL-FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001.md)（主板、非ST、上市满365日；待执行规格）。

[单因子、多因子与策略规则分类目录](research/FACTOR-CATALOG-BY-TYPE-20261010.md)（完整列出已盘点候选与组合，区分探索、停止及待核）。

[因子用途与证据总表、实验执行检查表](research/FACTOR-ROLE-EVIDENCE-REGISTER-20261010.md)（151% Runner、因子岗位、停止/替代结论与新实验门禁）。

当前下一步：[Event-State Long 正式执行一致性目标](research/GOAL-EVENT-STATE-LONG-EXECUTION-PARITY-001.md)（可交给其他模型执行）｜[项目与最新研究复核](research/PROJECT-REVIEW-NEXT-STEPS-20261010.md)。

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
| `docs/strategy/` | [`STRATEGY-003-report.md`](strategy/STRATEGY-003-report.md)｜[`STRATEGY-003-difference-report.md`](strategy/STRATEGY-003-difference-report.md)｜[`STRATEGY-004-report.md`](strategy/STRATEGY-004-report.md)｜[`STRATEGY-RESEARCH-BRIDGE-001-REPORT.md`](strategy/STRATEGY-RESEARCH-BRIDGE-001-REPORT.md)｜[`STRATEGY-DEVELOPMENT-TEMPLATE.md`](strategy/STRATEGY-DEVELOPMENT-TEMPLATE.md) |
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
| [`RESULT-3F-TOPN-3-V1_62_1-OOS-WFA-001.md`](research/RESULT-3F-TOPN-3-V1_62_1-OOS-WFA-001.md) | **3F Top3 v1.62.1 固定配置验证**（OOS + 阈值敏感性 + 成本×2 + WFA；3 PASS / 3 FAIL，证据不支持进入 Candidate） |
| [`RESULT-3F-TOPN-3-V1_62_1-ATTRIBUTION-001.md`](research/RESULT-3F-TOPN-3-V1_62_1-ATTRIBUTION-001.md) | **3F Top3 v1.62.1 归因优化**（市场状态归因 + 三维过滤 + Top1/Top2 压缩 + 成本×2；有效使用边界 = 涨停家数不冷清，成本敏感期叠加沪深300闸门） |
| [`RESULT-3F-TOPN-3-V1_63_0-REGIME-FILTER-001.md`](research/RESULT-3F-TOPN-3-V1_63_0-REGIME-FILTER-001.md) | **冻结 1.63.0（涨停生态闸门）验证**（OOS/WFA/成本×2 与 v1.62.1 对比；降依赖但**不达候选**，阈值边界 ±1 换 ~12pp） |
| [`RESULT-REGIME-ROBUSTNESS-001.md`](research/RESULT-REGIME-ROBUSTNESS-001.md) | **REGIME-ROBUSTNESS-001 阈值平台性检验**（p25/p33/p40/p50 四组同规格 OOS/WFA/cost×2 + 2023 亏损拆解；**非平台型**，不可冻结为下一候选） |
| [`RESULT-REGIME-NORMALIZATION-001.md`](research/RESULT-REGIME-NORMALIZATION-001.md) | **涨停家数 regime 归一化比较**（A 绝对家数 / B 涨停率 / C 前120日滚动分位；OOS + 2019-2026 WFA + 成本×2；相对活跃度方向更稳，C 最值得继续验证） |
| [`RESULT-REGIME-NORMALIZATION-ROBUSTNESS-002.md`](research/RESULT-REGIME-NORMALIZATION-ROBUSTNESS-002.md) | **相对涨停活跃度 9 组矩阵**（window 60/120/250 × P25/P33/P40；无稳定 2×2 平台，暂不创建 Candidate；平台未成立故按规则跳过 rolling WFA） |
| [`RESULT-DYNAMIC-3F-BUCKET-ENTRY-001.md`](research/RESULT-DYNAMIC-3F-BUCKET-ENTRY-001.md) | **3F 桶分 Entry Timing**（T+1/T+2/T+3/T+4/T+5；T+5 精确复现 1.62.1；提前入场均不优于固定 T+5，不创建 Candidate） |
| [`RESULT-ENTRY-TIMING-FACTOR-RESEARCH-001.md`](research/RESULT-ENTRY-TIMING-FACTOR-RESEARCH-001.md) | **各 Te 独立单因子研究**（IC/ICIR、五分位、Q5-Q1、PF、年度方向稳定性、OOS；T+5/T+4 优，T+1/T+2 不成立） |
| [`RESULT-FIRST-BOARD-TREND-FILTER-001.md`](research/RESULT-FIRST-BOARD-TREND-FILTER-001.md) | **首板回撤 + 趋势过滤 + 3F Top3 股票池**（7 组 MA/价格位置/MA20支撑规则；趋势过滤有效，当前3F Top3未提供增量，未创建策略版本） |
| [`RESULT-TREND-POOL-3F-BREADTH-001.md`](research/RESULT-TREND-POOL-3F-BREADTH-001.md) | **B趋势池内原3F固定五分位**（Q1-Q5、年度/OOS/单调性；无单调质量梯度，高分组更差，不保留为质量评分器） |
| [`RESULT-TREND-POOL-MA-DEVIATION-001.md`](research/RESULT-TREND-POOL-MA-DEVIATION-001.md) | **T+5价格-均线偏离与均线方向**（D10/D20、MA10/MA20Slope、固定分档/二分位/交叉与年度；D20越高越差，深负偏离有局部反弹，深跌+均线弱/平优于深跌+均线向上） |
| [`RESULT-MA-DEVIATION-REVERSAL-002.md`](research/RESULT-MA-DEVIATION-REVERSAL-002.md) | **深度负偏离反弹路径**（D20<-10%、UP/DOWN、逐日路径、首次达标、MFE/MAE、年度；DOWN总体优但依赖右尾，暂不做独立交易池） |
| [`RESULT-TREND-POOL-RIGHT-TAIL-001.md`](research/RESULT-TREND-POOL-RIGHT-TAIL-001.md) | **首板回撤池右尾捕获能力**（T+6 起算的 +3%~+30% 命中、首次达标、P75/P90/P95、MFE/MAE、Top5/10贡献与逐年；深跌+MA20 DOWN 的 +10/+20 命中最高，过度上偏 +30 最高但左尾最差） |
| [`RESULT-EXIT-PATH-RESEARCH-001.md`](research/RESULT-EXIT-PATH-RESEARCH-001.md) | **深跌反弹池退出路径**（MFE/MAE、首次达标与峰值时间、达标后回撤、固定目标退出 vs 实时/事后峰值回撤、T+7~T+20 时间退出与逐年；大赢家峰值偏后、事后峰值捕获不可交易，暂不创建退出规则） |
| [`RESULT-EXIT-CONFIRMATION-002.md`](research/RESULT-EXIT-CONFIRMATION-002.md) | **深跌反弹池趋势破坏退出**（+5/+10/+15 盈利激活 × 6 个固定因果信号；退出日/收益/PF/捕获率/回撤/大赢家保留与逐年；破前低最易过早、连跌2日与MA10相对平衡，但均不优于同条件T+20，不创建Candidate） |
| [`RESULT-PROFIT-RUNNING-STATE-003.md`](research/RESULT-PROFIT-RUNNING-STATE-003.md) | **盈利奔跑 + 慢速趋势破坏确认**（+5/+10/+15 × 连跌2日/破MA10/T+20；慢速确认优于立即止盈但不及T+20，右尾保留下降，年度不稳定；不适合直接采用退出框架，不创建Candidate） |
| [`RESULT-RUNNER-STATE-RESEARCH-004.md`](research/RESULT-RUNNER-STATE-RESEARCH-004.md) | **Runner 当下状态研究**（+10/+15 激活后 D1~D5，13 个 PIT 状态；保留逐日原始状态，不创建Candidate） |
| [`RESULT-RUNNER-SELECTION-005.md`](research/RESULT-RUNNER-SELECTION-005.md) | **Runner 单状态二次筛选**（+10/+15 后 D1~D5 的单变量候选池、每日候选数/占比/捕获倍数/收益/右尾集中度；可作持仓升级层，但 Exit 仍是主要瓶颈，不创建Candidate） |
| [`RESULT-EXIT-TREND-DETERIORATION-006.md`](research/RESULT-EXIT-TREND-DETERIORATION-006.md) | **Runner 趋势衰竭单变量转移**（+10/+15 激活后逐日扫描 MA/斜率/短收益/创新高/收盘/量能/连续收低转移；Exit后机会损失、MAE、时点与逐年；单变量转移普遍过早，不创建Candidate） |
| [`RESULT-EXIT-CONFIRMATION-007.md`](research/RESULT-EXIT-CONFIRMATION-007.md) | **首次 Runner 转弱后的二次确认**（D+1/D+2/D+3 恢复、创新高/收益/收盘恢复、延迟退出与年度稳定性；恢复状态显著优于持续弱状态，但延迟退出仍损失大量右尾，不创建Candidate） |
| [`RESULT-EXIT-SECOND-CONFIRMATION-008.md`](research/RESULT-EXIT-SECOND-CONFIRMATION-008.md) | **Exit 二次确认路径**（恢复/持续弱/未创新高/收益未恢复/收盘未恢复；D+1~D+3、与D0退出、剩余MFE/MAE、lost20/30、峰值保留与逐年；二次确认能分层，但暂不升级规则） |
| [`RESULT-EXIT-PATH-VALIDATION-009.md`](research/RESULT-EXIT-PATH-VALIDATION-009.md) | **路径型 Exit 原型验证**（Recover持有/Continue Weak退出，D+0~D+3、收益/捕获/lost/峰值保留与逐年；D+3相对D0改善但改善有限且非每年一致，可进入正式验证但不创建Candidate） |
| [`RESULT-STRATEGY-EXIT-VALIDATION-010.md`](research/RESULT-STRATEGY-EXIT-VALIDATION-010.md) | **正式 Strategy/Backtest Exit 验证**（D0/D+1/D+2/D+3 × +10/+15 激活，真实 T+1 成交、成本×2、IS/OOS/逐年；正式链稳定可执行，但 D0 优于延迟确认，不进入下一阶段 OOS/WFA、不创建 Candidate） |
| [`RESULT-3F-TOPN-3-V1_62_1-T80-001.md`](research/RESULT-3F-TOPN-3-V1_62_1-T80-001.md) | **1.62.1-T80 路径扩展验证**（660001=v5/T+20 不支持 T80，实际使用 v7=750001 的 rd1..80；策略 T20/T80 完全一致，T80 路径显示超六成交易在 T+20 后再创新高/峰值，仅作 Runner/Exit 研究增量，不创建 Candidate） |
| [`RESULT-RUNNER-STATE-T80-001.md`](research/RESULT-RUNNER-STATE-T80-001.md) | **1.62.1 实际成交样本的 T+10/T+15/T+20 Runner 状态研究**（固定 1,359 笔成交；单变量经济分箱/二值/连续状态；T+1..T+80 MFE/MAE/右尾达成与年度稳定性；候选为 T+10/T+15 创新高、T+10 连续收低、T+15 连续创新高、T+20 三日创新高，不组合、不创建 Candidate） |
| [`RESULT-RUNNER-STATE-EMBEDDED-001.md`](research/RESULT-RUNNER-STATE-EMBEDDED-001.md) | **5 个 Runner 状态独立内嵌验证**（固定 1.62.1 实际成交与执行规则；5 个状态分别对 T+1..T+80 路径、年度/IS/OOS、实际策略与 cost×2 做只读验证；全部只能证明研究层右尾信息，未创建 Candidate、未设计 Exit） |
| [`RESULT-RUNNER-HOLD-T20-NEWHIGH3-001.md`](research/RESULT-RUNNER-HOLD-T20-NEWHIGH3-001.md) | **T+20 newHigh3 Runner 持有层严格验证**（原 1.62.1 时间退出最晚第10日，0 个仓位自然存活到 T+20；严格版 Runner 延长 0 次、指标与 Baseline 完全一致；反事实状态仅有有限右尾信息且 MAE 扩大，不创建 Candidate） |
| [`RESULT-RUNNER-HOLDING-BRIDGE-001.md`](research/RESULT-RUNNER-HOLDING-BRIDGE-001.md) | **Runner Holding Bridge 单变量验证**（T+10 第5持有日 PIT 状态决定延长至 T+20/T+80；12×2 正式 simulator 矩阵；NEW_HIGH_3_T74、CONSECUTIVE_HIGHER_HIGHS_GE_2_T74 等形成稳定平台，cost×2 为正，证明右尾可转化为实际 P&L，但不创建 Candidate） |
| [`RESULT-RUNNER-HOLDING-BRIDGE-001-CONSISTENCY.md`](research/RESULT-RUNNER-HOLDING-BRIDGE-001-CONSISTENCY.md) | **Runner Holding Bridge Baseline 口径修正**（正式 1.62.1 性能基线 1,359/+57.73% 与 T80 可执行研究基线 1,619/+15.79% 的差异、T14/T74 真实语义、版本留档与是否重跑结论） |
| [`RESULT-RUNNER-HOLDING-NEWHIGH3-T80-001.md`](research/RESULT-RUNNER-HOLDING-NEWHIGH3-T80-001.md) | **NEW_HIGH_3_T74 正式 Runner Holding Strategy 验证**（T+10 newHigh3 命中则取消原 T+10 时间上限、延长至 T+80；三层对照 A 正式 1.62.1 1,359/+57.73% 与 B Bridge 基线 1,619/+15.79%、C Runner 1,434/+151.10%；Full/IS/OOS/逐年/cost×2；Runner 增量来自右尾少数大赢家，离场仍由原止损/趋势决定；不创建 Candidate） |
| [`RESULT-RUNNER-HOLDING-NEWHIGH3-OOS-WFA-001.md`](research/RESULT-RUNNER-HOLDING-NEWHIGH3-OOS-WFA-001.md) | **NEW_HIGH_3_T74 严格 OOS + Rolling WFA**（规则/执行全冻结；full parity PASS；standalone OOS 2025–2026 B +47.22% → C +105.84%、cost×2 由 +33.92% → +81.94%；逐年 WFA 7/8 年增量>0、累计 B +9.50% → C +167.34%、cost×2 由 −34.46% → +52.94%；但绝对盈利集中 2021/2025、2023 双口径转差、增量高度右尾且 2021 改善来自资金循环；分类 **CONDITIONAL**；不创建 Candidate） |
| [`RESULT-RUNNER-NEWHIGH3-HORIZON-001.md`](research/RESULT-RUNNER-NEWHIGH3-HORIZON-001.md) | **NEW_HIGH_3 Runner 持仓延长终点边界**（A 不启用 / B hold10 / C hold20 / D hold40 / E hold60 / F hold74；同一 T80 execution projection，A/F parity 全过；Full A 15.79%→B 23.48%→C 129.69%→D=E=F 151.10%；**D/E/F 经济结果完全相同、`RUNNER_BRIDGE_TIME_EXIT=0`** ⇒ 右尾不是「足够长持仓上限」产生，hold20 已捕获 A→F 权益增量 84.2%、hold40 兜住余量；边际台阶 B→C +106,207 / C→D +21,410 / D→E→F = 0；OOS + WFA 稳定性 C/D 7/8 优于基线；直接增量 250,337 vs 资金循环残差 −115,029；不创建 Candidate） |
| [`RESULT-RUNNER-NEWHIGH3-FORWARD-001.md`](research/RESULT-RUNNER-NEWHIGH3-FORWARD-001.md) | **NEW_HIGH_3 Runner 持仓边界 Forward Validation（hold=20 vs hold=40）**（只比较 A 无 Runner / C hold20 / D hold40；IS 2019-2024 vs OOS 2025-2026 + 2025/2026 拆分；A/C/D parity 全过；OOS A 47.22%→C 99.04%→D 105.84%；C-A 四窗口同向为正（IS +46.94pp、OOS +51.82pp、2025 +54.35pp、2026 +4.59pp）；**D-C 不成立**——FULL 只改变 14 笔持仓，IS 逐笔净额差 −4,471（1 正 6 负）与 OOS +5,564 方向相反，OOS 正增量全由单笔 `600860.SH@2025-01-07`（+6,838）承担，剔除后 −1,275；仍为右尾主导（Top10% 占比 74~88%）；结论只支持 hold=20 进入评审，不采用 40/60/74；不创建 Candidate） |
| [`RESULT-RUNNER-NEWHIGH3-PROMOTE-001.md`](research/RESULT-RUNNER-NEWHIGH3-PROMOTE-001.md) | **NEW_HIGH_3 Runner / hold=20 正式 Strategy 提升验证**（ACCEPTED 登记；正式基线 parity **PASS**——canonical v5 精确复现 +57.7330390741% / 1,359 笔；v7 执行投影 A/C 复现 HORIZON-001——A 15.79%/1619、C 129.69%/1453、触发 159；C−A +113.90pp / MaxDD −9.75pp / PF +0.1193，直接增量 237,957、资金循环残差 −124,059、Top10% 占比 81.3%；**实际净增量 vs 正式基线 +71.95pp**，须拆为「执行投影迁移 −41.95pp + Runner +113.90pp」；**Candidate 未创建**——旧 Conclusion 表已归档、独立实验桥要求 `750001` 上的 PASS HOLDOUT Run 而现库不存在，拒绝绕过） |
| [`RESULT-COMPOSITE-RUNNER-HOLDOUT-001.md`](research/RESULT-COMPOSITE-RUNNER-HOLDOUT-001.md) | **组合层 HOLDOUT 证据补齐（BLOCKED）**（为 `NEW_HIGH_3 Runner / hold=20` 建正式 Bridge 所需的 HOLDOUT Run：**未创建 Run / 未创建 Candidate / 未改正式 Strategy**。Blocker A：实验框架无组合执行面且禁止实验 import `server/**` 或直连 DB（EXPERIMENT-CODE-SPEC.md:560/561/651），唯一组合形状实验是另一套策略、无法复现 PROMOTE-001；Blocker B：`createStrategyFromEvidenceRuns` 只产出 Strategy Version + 溯源，无 `research_strategy_candidate` 写入路径（旧 conclusion/experiment 表已归档）；Blocker C：新增实验需跨端注册（manifest + 前端 page）。附最小修复清单与已复核证据） |
| [`RESULT-COMPOSITE-RUNNER-BRIDGE-001.md`](research/RESULT-COMPOSITE-RUNNER-BRIDGE-001.md) | **组合执行能力下沉（PARTIAL）**（新增 `server/research/compositeRunner/` = 组合执行唯一实现（`runCompositeRunnerBacktest` 唯一调用既有 `runTradeSimulation`，零第二引擎）+ 实验侧零实现桥 + `ExperimentDescriptor.executionSurface`；**模块级 parity 精确 PASS**：A 15.7877%/1619、C 129.6860%/1453 等于 PROMOTE-001；脚本已委托共享模块；**§3–§5 阻塞**——Experiment 取数面拿不到 v5 完整 rows / `universeDefinition.days` / `policySet`，无法重建双数据集投影，故未用近似数据集伪造 PASS；附 `compositeDatasetProvider` 最小修复项） |
| [`RESULT-COMPOSITE-RUNNER-HOLDOUT-EXECUTE-001.md`](research/RESULT-COMPOSITE-RUNNER-HOLDOUT-EXECUTE-001.md) | **组合层 HOLDOUT 闭环执行（PARTIAL）**（OBSERVATION `RUN-20261002-258E7B8B` → HOLDOUT `RUN-20261002-BD1D7332`：gate **PASS**、隔离 **CLEAN**、PROMOTE-001 parity 精确（A 15.7877%/1619、C 129.6860%/1453、trigger 159）、holdout C 99.0365% vs A 47.2185%；**Strategy Bridge 阻塞**——`definitionBuild.ts` 无 `exitPolicy`/`runnerBridge` 映射，产出的 Strategy Version 无法携带 Runner，故未创建空壳版本；附最小修复项） |
| [`RESULT-STRATEGY-BRIDGE-RUNNER-FINAL-001.md`](research/RESULT-STRATEGY-BRIDGE-RUNNER-FINAL-001.md) | **Bridge 修复 + 完整 Strategy Version（DONE）**（`definitionBuild.ts` 支持 `exitRule.policy`；`runWorkbenchAssembly/exitPolicy.ts` 透传 `runnerBridge`；Draft = `projectCandidateSketch(FIRST_LIMIT_PULLBACK_3F_TOPN3)` + canonical exitPolicy + runnerBridge；12 项创建前强校验全 PASS；产物 Strategy Version **3570001** + provenance **660001**（`INDEPENDENT_EXPERIMENT`，引用 HOLDOUT `RUN-20261002-BD1D7332`）；语义完整等于 `first-limit-pullback-3f-top3@1.62.1 + NEW_HIGH_3 hold=20`；正式提升前最终 Gate **达到**） |
| [`RESULT-STRATEGY-3570001-FINAL-EVALUATION-001.md`](research/RESULT-STRATEGY-3570001-FINAL-EVALUATION-001.md) | **3570001 最终评估（DONE）**（3570001 vs 1.62.1 同数据/窗口/simulator/成本；Full 15.7877%/1619 → **129.6860%/1453**、MaxDD 54.8080%→45.0611%、PF 1.1366→1.1853；OOS 43.46%→77.46%；成本×2 −34.50%→+23.49%；Runner 触发 159、直接增量 237,957、Top10% 占比 81.26%；集中度 Top5% 364%/Top10% 483%；持久化 `closed_loop_backtest_run` **5970001 / 5970002**；新增前端页 **`/strategy-final-evaluation`** 经 `researchRun.getFinalEvaluation` 读取，零硬编码；进入模拟盘前评估 Gate **达到**） |
| [`RESULT-STRATEGY-3570001-PAPER-TRADING-001.md`](research/RESULT-STRATEGY-3570001-PAPER-TRADING-001.md) | **3570001 每日模拟盘闭环（DONE）**（`server/paperTrading3fTop3Runner/*` 对同一次正式模拟按日投影 → signals/fills/positions/exits/account；留档 `closed_loop_backtest_run` **6000001**（runId `paper-3570001-2025-01-01-2026-09-04`，407 交易日）；权益 199,036.53 / 累计 **+99.0365%** / MaxDD **16.3391%**；信号 1,219 / 成交 617 / 退出 306；前端 **`/paper-trading-3570001`** 经 `researchRun.getPaperTrading3570001` 读取，零硬编码） |
| [`RESULT-STRATEGY-3570001-LIVE-PAPER-TRADING-001.md`](research/RESULT-STRATEGY-3570001-LIVE-PAPER-TRADING-001.md) | **3570001 持续前向模拟盘（PARTIAL）**（`forward.ts` 增量/幂等/断点恢复 + `service.ts` `runNextAvailableDay` + tRPC + CLI + 页面新区块；11 tests passed；真实运行 **`WAITING_FOR_NEW_DATA`**（2026-09-04 为最新数据，0 新增交易日，未伪造行情）；**阻塞**：`closed_loop_backtest_run` 大载荷读回取不到 `result.paperTradingState`，前向未从 6000001 账户继续、页面区块为空；附最小修复项） |
| [`RESULT-PAPER-TRADING-PERSISTENCE-FIX-001.md`](research/RESULT-PAPER-TRADING-PERSISTENCE-FIX-001.md) | **闭环留档扩展载荷读取修复（DONE）**（新增 `getClosedLoopBacktestRunRawResult(runId)` 按 runId 直读原样 JSON、不经旧闭环 reconcile；6000001 恢复 equity **199,036.53** / cash **5,381.53** / 持仓 5 / lastProcessed 2026-09-04；forward reseed 后 **`WAITING_FOR_NEW_DATA`**、0 新增记录、账户与基线一致；5970001/5970002 仍可读；前端四区块可读零硬编码；386 passed / 35 files） |
| [`RESULT-ENTRY-EXIT-CLOCK-001.md`](research/RESULT-ENTRY-EXIT-CLOCK-001.md) | **实际入场日计持有 vs 固定事件日退出：口径一致性实验**（复用已验证 1.62.1 执行投影；1,619 笔真实成交入场日 100% = T+6，两时钟无日期错位；358/358 TIME_EXIT 与 H_fill(5) 逐笔一致；研究标签口径系统性高估可执行收益 7~15bp/笔；收益分布均值>0 但中位<0 且随持有期恶化；受控入场面板显示入场延迟主要改变风险暴露长度而非均值；不创建 Candidate） |
| [`RESULT-RUNNER-STATE-CLOCK-MAP-001.md`](research/RESULT-RUNNER-STATE-CLOCK-MAP-001.md) | **Runner/Exit 状态变量从持有日时钟到事件相对日时钟的映射检验**（持有日时钟 ≡ 事件日时钟 4,855/4,855 日期一致；13 个冻结状态 × 3 观测日 × D=80：36/39 方向不变、3 个翻转全在零点附近或极低覆盖、0 个强度变化达 2σ；真正敏感的是观测日平移 ±1~2 日——MA10_SLOPE_POSITIVE 与 MA5_ABOVE_MA10 三档全稳，NEW_HIGH_2/3、连续创新高/收低、NEAR_5D_HIGH 不稳；不创建 Candidate） |
| [`RESULT-EXIT-STATE-DECISION-001.md`](research/RESULT-EXIT-STATE-DECISION-001.md) | **状态出现即退出 vs 继续持有：增量价值实验**（6 状态 × T+10/15/20 × T+20/40/60/80，共 66 单元，全部 H_fill 可执行口径；增量均值多为正但中位几乎全为负、胜率仅 37%~51.3%，Top10% 贡献反复 >100%；仅 2 个边际 T+20 单元为「广泛型」且年度 5/3；Runner 延长臂 NEW_HIGH_3@T+10→T+80 = 均值 +1.54pp / 中位 −2.28pp / 胜率 43.9% / 负部均值 −16.95pp；明确「相关 ≠ 适合退出规则」；不创建 Candidate） |
| [`RESULT-EXIT-STATE-REVERSAL-001.md`](research/RESULT-EXIT-STATE-REVERSAL-001.md) | **Exit State Reversal：状态由成立变为失效/反转后退出是否有增量价值**（5 状态 × RAW/SUSTAINED 两口径 × 继续持有至 T+40/60/80，全部 H_fill 可执行；RAW 首次失效被 rd6 噪声主导，5 状态几乎同值无区分度；SUSTAINED 要求状态连续成立 ≥5 日后才允许讨论失效——NEW_HIGH_3/连续抬高等 2 失效退出均值约 +12%（选择效应），继续持有呈右尾型；唯一 BROAD 单元为 `CONSECUTIVE_LOWER_CLOSES_GE_2`→T+80（增量均值 +2.09pp / 中位 +0.29pp / 正比例 51.6% / 年度 7/1），其语义为「反弹开始」而非趋势破坏；不创建 Candidate） |
| [`RESULT-CLC2-PORTFOLIO-001.md`](research/RESULT-CLC2-PORTFOLIO-001.md) | **CLC2 Rebound Confirmation Portfolio Experiment**（真实组合资金循环下检验 CLC2 反弹确认后继续持有的优势；冻结 1.62.1 下 CLC2 触发 0 次——平均持有 5.6 日 vs 信号 rd≈40；延长至 T+80 并保留 6% 止损/MA 趋势后仍只触发 2 次；纯 CLC2 坐标（关闭竞争退出、A/B 同为 25 槽×4%）下结论反转：确认后退出 +30.08% vs 继续持有 +18.59%（差 +11.48pp、MaxDD 改善 2.18pp）；持有层同组均值 +2.53pp 但组合层因资金占用与机会成本相反；不创建 Candidate） |
| [`RESULT-CLC2-HORIZON-001.md`](research/RESULT-CLC2-HORIZON-001.md) | **CLC2 × Holding Horizon Experiment**（T+20/40/60/80 四窗口 × A 固定退出 / B CLC2 确认退出 / C 忽略 CLC2 持有到窗口，统一 25 槽×4% 纯持有坐标真实资金循环；A→B 增量 T20 −8.27pp、T40 −0.08pp、T60 +11.12pp、T80 +11.48pp ⇒ CLC2 仅在较长窗口有决策价值，转折在 T40–T60；CLC2 退出在四窗口均释放资金并带来更多后续成交；单笔同组「继续持有」增量均值 +0.88/+1.95/+4.97/+2.53pp，但组合层短窗口相反 ⇒ 单笔路径与组合机会成本必须分开；无全年度一致稳定平台；不创建 Candidate） |
| [`RESULT-RUNNER-STATE-RESEARCH-004-T80.md`](research/RESULT-RUNNER-STATE-RESEARCH-004-T80.md) | **RUNNER-STATE-RESEARCH-004 的 T80 延伸**（固定池 D20<-10% && MA20Slope<=0，+10%/+15% 激活后 D1~D5 × 13 冻结状态；1,081 T80 可评估事件、135,034 条状态观测；多数「强势」状态反而指向衰竭——MA10_SLOPE_POSITIVE +10% 增量 −7.43pp/stdDiff −0.260/年度 0-8、CLOSE_ABOVE_MA10 −6.72pp、NEW_HIGH_3 −5.78pp；唯一正向且年度 8/0 的是 CONSECUTIVE_LOWER_CLOSES_GE_2（+4.43pp/+15% +5.58pp）；+20%/+30% 两种口径因选择效应相反——从入场价看强势状态更易达标、从状态收盘看强势状态剩余空间更小；S=10/15/20 与 ±2 天平移下无状态方向全稳；相关≠可执行 Exit；不创建 Candidate） |
| [`RESULT-RUNNER-STATE-TRANSITION-001.md`](research/RESULT-RUNNER-STATE-TRANSITION-001.md) | **Runner 强势状态 ↔ CLC2 先后状态转换**（固定池 D20<-10% && MA20Slope<=0，+10%/+15% 激活，T80 投影，13 冻结状态；强势=NEW_HIGH_3 / MA10_SLOPE_POSITIVE / CLOSE_ABOVE_MA10；去重后转换 12,366 条；CLC2→强势恢复方向最强——CLC2→NEW_HIGH_3 T+80 均值 +3.53%/+3.38%、CLOSE_ABOVE_MA10 +3.00%，年度 5/3；而强势→CLC2 基本 0 附近甚至为负（MA10_SLOPE_POSITIVE −0.01%/−0.36%）⇒ CLC2 的正向效果来自「回撤后重新走强」而非 CLC2 本身；锚点对照「未恢复」样本过小；不创建 Candidate） |
| [`RESULT-RUNNER-STATE-RECOVERY-001.md`](research/RESULT-RUNNER-STATE-RECOVERY-001.md) | **CLC2 → NEW_HIGH_3 恢复的独立增量信息**（共同锚点=激活后首个 CLC2 日，前向收益从同一锚点起算以避免前视；D1–D10 恢复 vs 未恢复 T+80 均值 +1.30% vs −9.80%（P10）、+1.08% vs −10.89%（P15），差值 +11.10pp/+11.97pp；恢复速度单调梯度 D1–3 +6.76%→D4–7 +2.42%→D8–14 −7.29%→D15–20 −10.83%→未恢复 −18.44%；LOW/MID/HIGH 三分层内恢复组均优于未恢复组；corr(恢复延迟,T80)=−0.195/−0.206 而 corr(锚点相对MA10,T80)≈0 ⇒ 不是单纯价格位置效应；D1–20 未恢复样本仅 6–8 条，生存偏差显著；不创建 Candidate） |
| [`RESULT-RUNNER-STATE-RECOVERY-TIMING-001.md`](research/RESULT-RUNNER-STATE-RECOVERY-TIMING-001.md) | **CLC2 后 NEW_HIGH_3 恢复的实际发生日是否携带增量信息**（共同锚点=首个 CLC2；固定日历口径两组同起点；T20 差（已恢复−尚未恢复）D2–D8 为负（约 −1.1~−5.4pp）、D9/D10 转正 +0.23/+0.90pp；当日恢复口径 D6–D9 最强（T20 均值 +5.15~+6.72%）；corr(恢复延迟,恢复日后T20)≈0 ⇒ 上轮「越快越好」主要来自起点日历不同；固定日历下「尚未恢复」样本锚点→D 涨幅与相对 MA10 显著更低 ⇒ 恢复状态与剩余空间高度纠缠，不作因果；D1 样本仅 15/16 条；不创建 Candidate） |
| [`RESULT-RUNNER-STATE-RECOVERY-CONTROL-001.md`](research/RESULT-RUNNER-STATE-RECOVERY-CONTROL-001.md) | **NEW_HIGH_3 恢复是否超出价格位置/剩余空间的增量信息**（共同锚点=首个 CLC2，D1–D10 固定日历；三层：L1 原始 / L2 四协变量三分位分层 / L3 四协变量最近邻匹配 caliper=1.0；匹配后 D4 +10% −2.20→+0.04pp、D8 +2.67→+0.03pp，D2/D4/D8 表观优势基本由价格位置解释；仅 D9 残差较大（+2.49/+4.45pp）但匹配样本仅 40/36 对且年度样本不足；主要判定=表观恢复增量主要由价格位置/剩余空间解释；不创建 Candidate） |
| [`RESULT-RUNNER-CLC2-CONTROL-001.md`](research/RESULT-RUNNER-CLC2-CONTROL-001.md) | **CLC2 本身是否超出价格位置/剩余空间的增量信息**（固定日历 CLC2 vs NOT，offset=4..20，T+6 入场；三层：原始 / 九协变量单变量分层 / 精确 gap 桶 + 7 协变量最近邻匹配 caliper 0.5、匹配率约 90%；原始 T20 差 +1.23/+1.03pp → 匹配后 +0.98/+1.33pp，但 T40/T60 衰减、胜率与中位差消失，2019/2023/2026 年度同时为负；`clc2Len` 无法平衡（CLC2 恒≥2、NOT 恒0）；判定=匹配后不存在跨年度稳定增量 ⇒ Runner-State 研究线按预设标准关闭；不创建 Candidate） |
| [`RESULT-TOPN-SPACE-FACTOR-001.md`](research/RESULT-TOPN-SPACE-FACTOR-001.md) | **把「回撤/剩余空间」并入 3F Top3 排名是否改善选股**（A=1.62.1 3F 复合分 Top3，parity 1,619 笔/+15.79%；B=同池同 Top3，仅排序改为 z(3F)+0.5·mean(−z(6 个 PIT space 变量))；B 总收益 −39.07%（−54.86pp）、MaxDD −80.51%（−25.70pp）、PF 0.955；胜率几乎不变而 51% 决策日选股不同、turnover 561→370x；年度 2 正 6 负，2021 单项 −51.79pp ⇒ 判定关闭该方向；不创建 Candidate） |
| [`RESULT-T74-SUBNEW-FILTER-001.md`](research/RESULT-T74-SUBNEW-FILTER-001.md) | **151% 策略「次新股要不要从候选池剔除」对照实验（REJECTED）**（`RUN-20261007-68FD5C7F`；控制臂 parity PASS 151.0958%/1434；排序前剔除上市龄 < 365/180/90 自然日的候选（允许递补）⇒ 151.10% → 65.39%/131.15%/109.97%（Δ −85.71/−19.95/−41.13 pp），仅 `excl180` 多 1 笔 ≥+50% 但代价 −19.95 pp；阈值非单调 ⇒ 又一次「选股微扰」脆弱性证据；控制臂复算的次新成交 51 笔/+10,324 元与只读诊断互证；不创建 Candidate） |
| [`IMPACT-NETPNL-SIGN-001.md`](research/IMPACT-NETPNL-SIGN-001.md) | **`trades[].netPnl` 符号缺陷的影响分析 + 修复落地（P0✅ P1✅ P2✅ P3⬜ · 历史 Run 未回填）**（缺陷：`portfolio.ts` 的 `grossPnL` 用无滑点基准价、再扣**有符号**的 `slippageAmount`（`cost.ts:50`），而卖出侧滑点由 `base×(1−bps)` 结构性为**负** ⇒ 「减负数」= 又加回一次 ⇒ `netPnl` 高估 `2×\|卖出侧滑点\|`；量级吻合 **5.10bp vs 配置 5bp**；**双路径闭合** Σ`netPnl` 188,838 vs 权益台账 151,096 差 37,742，现金口径 145,747 低 5,349 ≈ 分红；**影响量化**（n=1429）：`profitFactor` **1.2073→1.1557（−4.3%）**、`expectancy` **−22.8%**、`winRate` 38.56%→37.93%（**9 笔符号翻转**）、**集中度反向变差** `top5` 329.87→**424.55%** / `top10` 438.73→**563.86%**（⇒ 151% 集中度结论被**加强**）；**不受影响**：`totalReturnPct` 151.0958% / CAGR / MaxDD / 权益曲线 / `cost` / `turnover`；**P0**：无任何判定/择优用 PF —— 参数搜索「只提供能力，不产出最佳参数结论」且默认按 `combinationIndex` 排序（`executor.ts:1053,1098,1126`），稳定区判定**仅用 `totalReturnPct`+`maxDrawdownPct`**（`region.ts:158-159`），稳健性漂移**仅比收益与回撤**，OOS 只有日期门禁，全仓 `profitFactor [<>]=?` **0 命中** ⇒ 影响止于「指标重算」；**修复**：`grossPnL` 改成交价口径 + `netPnl = gross − fees` + 删死字段 `entryBasePrice`；`BACKTEST_EXECUTION_POLICY_VERSION` **1→2**（同时是 cache 判据 ⇒ 旧缓存自然失效）+ `NETPNL_CALIBER = "cash-v2"`；新增锁 `netPnlCaliber.test.ts` **8/8（修复前 3/8 红，差值恰为 2×卖出滑点）**；🔴 **「零新增失败文件」已用实验证伪**（`git stash` 源码后在 HEAD 逻辑重跑 ⇒ 同样 3 文件 8 例失败、用例名逐条一致；那 3 个均为既有红：`limitUp*` 数据库不可用 + `threeFactorTopNStrategyDocument` 期望字面量缺 `recoveryPath`）；**未回填任何历史行**） |
| [`PLAN-TAIL-SELECTION-001.md`](research/PLAN-TAIL-SELECTION-001.md) | **右尾选择实验（预注册 · 未执行 · `ROADMAP` §44.5 `9cp`）**（唯一问题：**首板回踩候选池里有没有东西能识别右尾**）。**已固定的口径**：ds **780001** 唯一 · 候选池 **50,907**（ABORT 条件 = parity 失败）· 入场 `relativeDay 6` open · 出场 **20/40/60 三个持有期同时报、rd40 为主**（rd10 只 4 个交易日、池内 `≥+100%` 为 0 ⇒ 结构上测不到尾，已登记为上一轮局限）· 毛收益（靶阈值 ±50%/+100% 对 20bps 不可见，如实登记简化）· **全部年内归一化**。**四臂**：A **间隔过滤**（排除年内 `daysSincePreviousLimit` 三分位最高组；**用年内三分位而非探索里的 165 天绝对阈值**，绝对阈值会随年份漂移）/ B **3F 现状**（负向基线，已知反尾 −0.0365）/ C **无排序**（对照）/ D **反向臂**（取年内最短间隔组）⇒ 直接量化尾–均值权衡。🔴 **每臂必报尾率 + 均值 + 逐年**（§6.3 的尾–均值反向张力，不是可选项）。**事前判据**：A 在 rd20/40/60 **三持有期同向**优于 C 且 **≥6/8 年同向** ⇒ 采信；尾优但均值劣 ⇒ **预期结果**、如实登记；无差异 ⇒ 关闭该方向；B 未复现反尾 ⇒ **HARNESS 异常**先查；三持有期方向不一致 ⇒ 不采信。**不变量**：不改冻结桶边界/方向/权重 · 不接线连续分模块 · 不新增数据集版本 · 不使用 `sector`（1 年覆盖）/市值（全 null）/`turnover`·`sourceTurnoverAmount`（均值因子）/`historicalLimitCount`（年度检验已否）· 不在已看过的靶上调阈值。**本实验是池级统计、不产生新 Run**；仅某臂通过判据后才考虑进入正式策略验证）。🔴 **已执行（2026-10-07 · 只读 · 无新 Run）**：**ABORT 门禁第一次运行即触发，抓到的是我自己的 harness bug**（重建 SQL 漏 `relativeDay = 10`）—— 最大绝对差 `0.00e+0` 却报「不一致 50,836 项」，而 `50,836 = 50,907 − 71`（71 例两端同为 undefined）⇒ **数量关系自洽，证明是 harness 问题而非数据问题**；修正后 **parity 全绿**（池 **50,907** / 集合对称差 **0/0** / 收益重算 **0 项不一致**）。**结果**：**臂 A（间隔过滤）通过全部尾率判据**（三持有期同向 ↑、**8/8 年 ↑**、敏感性 2.95% vs 基线 2.72%）；🔴 **但四臂上「rd40 尾率」与「rd40 均值」排名完全颠倒（Spearman = −1）**：D 尾 **3.28%**/均值 **−2.661%** · A 尾 2.97%/均值 −1.582% · C 尾 2.74%/均值 −0.889% · **B（3F）尾 1.87%/均值 +0.441%**；尾部增益被均值损失以 **3.0×（A）/ 3.3×（D）** 吞掉；🔴 **算术级证明**：**均值本身已包含尾部事件** ⇒ 尾率升而均值降则尾部以外恶化必大于尾部增益；即使额外尾部事件每笔 +100%，A 期望增益仅 ≈+0.23pp 而均值代价 −0.69pp ⇒ **打平需捕获率约 300%，结构上不可能** ⇒ **「靠入场选择抓右尾」负期望**；🔴 **3F 的反尾不是缺陷而是特性**——臂 B 均值**最好**（+0.441% vs C 的 −0.889%，8 年中 5 年更优），且**三期全部劣于 C ⇒ 负向基线复现 ⇒ HARNESS 正常**。**结论：关闭「靠入场选择捕捉右尾」方向（不是关闭平台）；151% 的来源不在选股层，而在退出政策（Runner）**，与 `RESULT-151PCT-WINNER-CONCENTRATION-001` §3（9 笔 = 151%、Runner 38 笔 = 64.0%）一致) |
| [`PLAN-TAIL-SELECTION-002.md`](research/PLAN-TAIL-SELECTION-002.md) | **3F 取向翻转选股实验（`9cq` 重定向 · 实现已落地 · 5 臂比较未完成）**。**用户目标**：「本质还是想选出更多的右尾的超级股票」。🔴 **§-1 既有资产清查（新增强制门禁首次应用）**：`research_experiment_run` = **47 实验 / 162 Run**；选股侧**已测过** —— `single-factor-v1`（**39 条**，含 `maxAmplitude`/`meanAmplitude`/`t1VolumeRatio`/`historyLimitCount` 各自单因子）、`twelve-factor-*`、`composite-factor-*`（11）、t74 **P0/P0-2/P1 趋势融合排序** + **P4/P6/P7/P8/P9/P10**、`pre-event-context-study`、`oversold-gap-reversal-validation`、`post-event-amplitude-study`、`turnover-study`。✅ **真正缺口**：**没有任何既有实验把双振幅取向从 LOW 翻成 HIGH 或把排序目标从均值换成尾部**（P0/P1 是**同取向之上叠加**趋势分）。⚠️ **先验负面**：换排序已试两次 **−166~−228pp**；9cp 池级实测反向取向尾命中 **+59%** 但 `rd60` 均值 **+0.858%→−3.06%**。**5 臂**：A0/A 控制（有/无 Runner，兼 ABORT 门禁）· B0/B **取向翻转**（🔴 **`B ≡ C`**：`1−x` 严格单调 ⇒「翻转取向」与「取 top-3 反向」选中集合逐笔相同，原方案两臂合并）· D 翻转+Runner 延长 30。🔴 **§6.1 关键发现（平台隐患）**：`compositeRunner` 的 `scoreRankCandidates` 与扫描期 `threeFactorCompositeScoreOf` **各自持有 3F 排序、完全不读 StrategyDocument 的配方排序特征** ⇒ **改文档排序特征对该研究路径零影响**；且研究路径用**百分位**合成分、文档声明用**桶位分**合成分，**方向相同公式不同** ⇒ 隐患一直存在未被暴露。⇒ 初版 pattern 层实现（6 处 + 6/6 测试）**够不到目标层，已按裁定全部回退**（仓库反对「声明却无效」面）。✅ **修正版实现**落在真正排序的层：`compositeRunner` 新增 `orientAmplitudeScore(score, orientation)`（`"LOW"` 恒等=缺省**逐位不变**、`"HIGH"` 取补 `1−s` ≡ **三方向全翻**，桶边界与浮点同源）+ `buildCompositeEvents`/`buildFirstLimitPullback3FTop3SourceRun` 的 opt-in `amplitudeOrientation`；测试 **4/4**；**冻结契约未改**。🔴 **ABORT 门禁第二次开火（拦下假结论）**：脚手架 A0 = `13.2676340956%`（期望 `15.7876907121%`，1359 vs 1619 笔）、A = `15.4987447563%`（期望 `151.0958341843399%`，**21 vs 1434 笔**）⇒ 门禁失败 ⇒ **未解读任何臂**；若无门禁会得出「翻转毫无影响」的错误结论。**下一步**：建成**注册式实验**（照 `-stopwide` 范式）让框架按与对照臂逐位相同的方式装配面板与 runner ⇒ 门禁才有判别力；**在此之前不得给出任何取向翻转结论**。**0 DB 写入**（`6210006` 未变、`research_experiment_run` 仍 162）) |
| [`PLAN-RESEARCH-DESIGN-001.md`](research/PLAN-RESEARCH-DESIGN-001.md) | **重构研究实验的「科学有效性」协议（提案 · 未实施 · 待裁定）**。触发：用户「**不局限于这个策略，而是从研究实验那块重新确定实验**」。**先明确既有协议哪里好**：`.agents/research/SKILL.md` §3 十条**机械约束全部保留**（`datasetVersionId` 唯一坐标 · PIT 闸门 · 样本账平 · 账平≠全量 · ArtifactStorage 唯一出口 · 一个 Run 一个基准 · template+两注册点）——**它们保证可复现/可追溯/不伪造，是本仓最值钱的资产**。**缺的是科学有效性，六条缺口各附本 session 的具体事故**：① 🔴 **被排除样本从未检查是否与靶同分布** —— 回踩门剔掉的 **21,667 事件（29.8%）** 右尾**系统性更厚**（rd20 `≥+100%` **0.26% vs 0.12%，+117%**），而样本账一直是**平的** ⇒ 记账正确但无人问「剔掉的那群在靶上什么样」；② 🔴 **靶指标未声明且常与目标错配** —— t74 全程用组合总收益，而它 = **约 5 笔的统计量**（151.0958% = 9 笔、top10% 占比 438.7%），`bigWin50/100Count` 早在 schema 里却从未作主判据；③ 🔴 **测量仪器分辨力从未被评估** —— 3F 仅 **≤18 档**、**3 档覆盖 86.9%**、最高分**并列 262 笔**、破平键 = `securityId.localeCompare`（不透明 UUID）⇒ 三个不同扰动摆动几十~几百 pp（加宽槽位 **−1.5%**、剔次新 **65.39%**、trend 融合 **−166~−228pp**）——**不是因子弱，是仪器坏**；④ 🔴 **无效应量对照** —— P0–P10 多在 Runner（**89.5%**）固定时测选股小项，单参数 6%→8% 即摆动 **86.5pp** ⇒ Δ 落在主项噪声内；⑤ 🔴 **无预注册与停止规则** —— 47 实验/162 Run 呈广度堆叠，下一步由上一轮结果决定，既有合并结论「**这条链上没有免费降回撤的旋钮**」正是**矿脉挖尽**的签名；⑥ 🔴 **无时间/regime 分层** —— **6/9 赢家在 2025–2026**、2025 = 净利 **61%**、权益峰 **2022-03 → 2025-05-12（3.2 年空转，`maxDrawdownDurationDays=907`）** ⇒ regime 签名，而 run 的 **`regime` 阶段 = SKIPPED（未接线）**。**增补 = 实验「必答清单」7 条**（P2 靶指标 / P1 排除桶画像 / P3 入选边界分辨力四件套 / P4 效应量比值 / P5 预注册+停止规则 / P6 时间分层 / 既有样本账），**1–6 全是报告要求、多数可由既有 `customPayload`·`tables`·`statistics` 承载，不需新基础设施**。**实验组合重构为 4 族并各声明停止规则**：F1 门控 / F2 打分（**分辨力未达标不得做**）/ F3 退出 / **F4 时间·regime**。**根因结论**：**右尾是「时间/regime」现象，而全部既有工具都是「横截面」工具**；五条「尾–均值反向」是**同一结构事实的五次投影**，唯一有效的 Runner（89.5%）恰是**唯一非横截面**的杠杆 ⇒ **建议优先级 F4 > F1 > F3 > F2**。**待裁定三项**：是否写入 SKILL.md · 是否给 `ExperimentDefinition` 加 `targetMetric`/`preRegisteredCriteria` 两个可选字段 · 是否先做 F4 只读判定。**未改任何代码/协议/数据集/历史 Run，未新建实验、未产生 Run**；⚠️ 未知项：12 因子**筛选准则**仍未阅读（若当时用尾部感知准则，「靶错配」评语范围需收窄）) |
| [`RESULT-F4-REGIME-001.md`](research/RESULT-F4-REGIME-001.md) | **F4 判定（只读 · `PLAN-RESEARCH-DESIGN-001` §4）：151% 是 regime 敞口还是 alpha？** run `6210006` 权益曲线 1863 点 × `index_daily`（**000905.SH 中证500**）。🔴 **① 逐年**：**2021 +59.59% + 2025 +83.13% = +142.72pp ≈ 全部收益（8 年里 2 年给了一切）**；且**策略在指数上涨的 3 个年份（2019 +27.49% / 2020 +20.87% / 2024 +5.46%）反而是负的或持平 ⇒ 连 beta 都不是**；两个大年的 `≥+50%` 笔数是 **0 和 2** ⇒ **2021 的 +59.59% 与尾部零关系**（部分修正「151% = 9 笔」的表述）⇒ **时间集中度（2/8 年）比交易集中度（9/1434 笔）更极端，而平台从未测过时间集中度**。🔴 **② 决定性检验（策略日收益条件在指数是否 > MA20）**：指数 > MA20 的 **984 天（52.8%）日收益均值 +0.3868% / 累计 +4395.40%**；指数 ≤ MA20 的 **860 天（46.2%）日收益均值 −0.3000% / 累计 −92.42%**；全期 +225.44% ⇒ **日收益均值摆动 0.69pp/天，符号完全由指数 regime 决定；52.8% 的交易日产出全部收益，另外 46.2% 净亏**。⚠️ **方法学保留**：MA20 当日收盘才知而当日收益盘中已实现 ⇒ **存在轻微前视**，严格口径须用 **t−1** 状态重算（不改变结论方向，但正式采用前必须重算）。**③ 探针问错问题（如实登记）**：全期最高权益在 **2026-03-12（274,585）** 且此后未超越，故该问法定位到全期峰而非回撤恢复期；① 与 ② 已足够。**判定：151.0958% 主要是 regime 敞口，不是可复现的选股 alpha。** **与既有归因的和解（两者都对、层级不同）**：`RESULT-151PCT-ATTRIBUTION-001` 的 **Runner = 89.5%** 是**机制**（怎么赚）；本文档是**时机**（什么时候赚）⇒ **机制与时机正交：平台测了机制，从未测时机**。**影响**：✅ F4 优先级被证实（`regime` 是 run 里唯一 SKIPPED 阶段）；🔴 选股层微扰实验的相对价值被压低（为「47 个实验 Δ 全是大负数且不稳定」提供**第三个**独立解释）；⚠️ **不构成「F4 已可交易」**（含前视 + 样本内挑 MA20 有过拟合风险，正式需预注册 P5 + 样本外）。**边界**：未改代码/数据集/历史 Run，未新建实验、未产生 Run；未做多指数稳健性、未做统计显著性检验) |
| [`RESULT-F4-REGIME-001.md`](research/RESULT-F4-REGIME-001.md) 🔴 **更正** | **该文档 §4 判定「151% 主要是 regime 敞口」已作废（§0/§0.1）**：**① §0 前置检验**（t−1 口径消除前视 + 多指数 + 样本内外）把摆动从 **0.69pp/日 打到 0.07~0.16pp/日**（缩小 4~9 倍，上证 0.1300 / 沪深300 **0.0744** / 中证500 0.1580 / 深证成指 **0.0911**）；朴素 gate 代理价值**完全取决于挑哪个指数**（上证 +53.8pp · **沪深300 −22.2pp** · 中证500 +94.2pp · 深证成指 **+0.6pp**）；样本外摆动减半至 0.060pp/日且**样本外 ≤MA20 桶为正（+19.62%）** ⇒ 按事前判据（>0.3pp 才建实验、<0.1 即作废）**F4 作废**，`0.69pp/天` 是前视造出来的。**② §0.1 有界重试**（事前声明恰好 3 个变量、不得追加、t−1、分位边界仅样本内估计、通过判据 **≥0.15pp/日且样本内外同号**、停止规则「全不通过即停止」）：① 池候选数/日 **内 +0.3373 / 外 −0.5030** · ② 全市场涨停家数/日 **内 +0.3147 / 外 −0.3046** · ③ 全市场跌停家数/日 内 −0.2364 / 外 +0.0560 —— **三者样本内摆动全部超门槛，样本外全部翻号**（无条件：内 +0.0181%/日 · 外 **+0.1614%/日，强 9 倍**）⇒ **过拟合/噪声的教科书签名** ⇒ **按停止规则宣布「时间集中度不可解释」，停止，不建 regime 层**。**综合最终态**：151% **不能归因于** 选股（已穷尽）· 退出调参（已最优）· 池门控（已测）· **指数 regime（前视伪影）** · **市场热度/避险（样本外翻号）** ⇒ **最简约解释：该时间集中度不由任何 PIT 可测变量解释** ⇒ 应**按 regime/运气依赖定位与仓位管理**，或**承认为未获证明**。**教训（已并入 P6 精神）**：任何「当日状态划分当日收益」的 regime 检验**必须用 t−1 口径**；**单指数结论必须做多指数**；**追加变量即 forking paths（违反 P5）**。⚠️ 未测「连板高度」等更细变量（成本所限），但**按事前停止规则不得追加**。**本轮全程只读，0 DB 写入**。**这是本 session 第四次由事前判据拦下自己的结论**（前三次：ABORT 门禁 ×2 + §0 前置检验）) |
| [`RESULT-151PCT-ATTRIBUTION-001.md`](research/RESULT-151PCT-ATTRIBUTION-001.md) | **151% 的单笔归因：「选择」还是「持有/退出」（只读 · 0 新 Run）**。🔴 **顺带在真实数据上闭合了 `IMPACT-NETPNL-SIGN-001` 的修复**：用成交价重算 `cash-v2` 净额 = **145,746.92**，与**另一条独立路径**逐位相同；cash-v1 超出权益台账 **+37,742.01**（= 诊断缺陷额）、cash-v2 残差 **−5,348.92 ≈ 分红**。🔴 **权威答案（平台 `evaluationDetail` 自带受控消融 `sameData/sameWindow/sameCostModel`）**：无 Runner（`1.62.1`）**+15.7877%** → 有 Runner（`2.0.0`）**+151.0958%**，`delta` = **+135.31pp**；机制分解 `directPnlIncrement` **+250,337.01** + `capitalCycleResidual` **−115,028.87** = **+135,308.14**（**逐位对账**）⇒ **Runner = 151.10pp 的 89.5%，去掉只剩 +15.79%（7.7 年 ≈1.9%/年）**；`triggerCount=161`（`TREND_EXIT` 110 / `STOP_LOSS` 51，⚠️ 与「Runner 38 笔」是两个不同量，不可混用）。**单笔归因**：被执行入场 rd40 固定期均值 **+1.172%** vs 全池 **−0.889%** ⇒ **选择 +2.06pp/笔**（选择有效但**不充分**）；退出政策在**单笔均值**上是 **−0.66pp（负）**，而**组合级净额是 +135.31pp（正）** ⇒ 🔴 **退出维度禁止用单笔均值评价**（差别正是 `capitalCycleResidual`，单笔均值看不见）。**止损** 579 笔合计 **−86,256**、中位 −6.047%（保护项）。**容量饱和**：`1863 天 × 5 仓位 ÷ 6.5 天 ≈ 1,433 ≈ 实际 1,434 笔`。**精确表述**：**选择是必要条件（把负期望池变微正），Runner 是充分条件（把它变成 151%）；去掉任一收益消失**。⚠️ 不得据此宣称 3F 打分更强（`9cp` 纯 top-3 集为 +0.441%，实际执行集 +1.172%，差额来自**容量约束二次筛选**）) |
| [`PLAN-EXIT-POLICY-001.md`](research/PLAN-EXIT-POLICY-001.md) | **`9cq` 退出政策参数实验（🔴 已作废 · 未执行 · 四臂全部与既有实验重复 ⇒ 重定向）**（唯一问题：**Runner 延长幅度与止损阈值这两个已量化一阶杠杆的最优区间**）。🔴 **与 `9cp` 根本区别**：本实验**必须产生新的持久化 Run** ⇒ 性质变为**写库** ⇒ `9cp` 的只读授权**不覆盖**。**已固定**：ds **780001** 唯一 · 窗口 2019-01-01..2026-09-04 · 初始 100,000 · 成本逐项同基准 · `NEXT_OPEN` + `blockLimitUpBuys` · `canonicalMetrics()` + `cash-v2` · **选股冻结不动（3F topN=3，唯一自变量是退出参数）**。**四臂**：A 基准（零改动复现，兼作 ABORT 门禁）/ B T+5 截断（禁用 Runner，验证 15.79% 锚点）/ C 延长至 16 日 / D 止损放宽至 −8%。🔴 **每臂必报 `runner.capitalCycleResidual`**（延长的隐性价格；只报 `directPnlIncrement` 会系统性高估）+ `maxDrawdownPct` + `top10SharePct` + OOS 段。**ABORT**：臂 A 必须复现 `totalReturnPct = 151.0958341843399`（容差 1e-6）**且 `tradeDigest`/`equityDigest` 与 run `6210006` 一致**（I-10），不一致即停止且不得解读其他臂。**红线**：不做网格/自动搜索（4 臂即止，看过后不得加臂）· 禁用单笔均值下结论（§3 已证会给出方向相反的错觉）· 退出参数**不在** `runtimeOverrides` 白名单（仅 `initialCapital`/`costModel`/`executionModel`）⇒ **每臂必须走 `applyDefinitionChange()` 发新 StrategyVersion（I-5）**，不得用运行时覆盖绕过 · 不修改/不删除 run `6210006`。**影响**：新增 3~4 条 Run + 3 个 StrategyVersion，**无 DDL / 无 migration / 无历史修改**，可回退。🔴 **2026-10-07：用户已授权执行，但第 1 步门禁侦察即发现四臂全部重复 ⇒ 我主动中止、未发任何新 Run、未发任何 StrategyVersion**。**证据**：`research_experiment_run` 已有 **162 条 Run / 约 50 个实验**，t74 家族 **12 个实验 / 16 条 Run**（P0–P10）：**D 止损放宽 = `-stopwide` 已跑**（`RUN-20261004-670F0677`；8/10/12% **全部更差** 151.10%→**64.64/76.53/45.13%**，回撤**更大** 43.30%→49.88/45.88/47.02%）；**C 延长 Runner = `-hold20`**（**+129.69%** vs 151.10%，⚠️ ds 750001≠780001）；**A/B = 各实验内置「控制臂 parity」**（常量 `15.7876907121%` / `151.0958341843399%` 已写死）；退出视界另被 `entry-aligned-exit-horizon-study`（**9 条**）· `threshold-race-policy-study`（3）· `conditional-pullback-state-exit-study`（2）等覆盖；**我设计的 ABORT parity 门禁本就是该项目既有范式**。**既有程序自己的合并结论**：**这条链上没有免费降回撤的旋钮**（换排序 −166~−228pp / 多买 DD 43→45~56% / 扩大止损 DD 43→46~50% 全部更差）。🔴 **我的过程缺陷**：**写完整预注册方案却没先查既有实验清单** —— 恰是用户首条消息抱怨的「广度优先堆叠、零垃圾回收」，差点往已有 162 条 Run 的程序里再加 4 条冗余 Run。✅ **产出的最有价值的东西 = 新增前置门禁**：**写任何 `PLAN-*.md` 前必须先清查 `research_experiment_run`（`GROUP BY experimentId`）+ `closed_loop_backtest_run` + `research-experiments/**/experiment.ts`（含 `tags` 的 P 编号）+ `CHANGE-AUDIT.md` 对应 `TASK-ID`；已被既有实验回答的问题 ⇒ 不得新建实验，只登记「已答」+ 出处。** **重定向**：`9cq` 编号保留，内容改为既有程序指出且**至今未执行**的两条之一 —— ① **降低暴露**（每笔仓位比例 ↓ / 保留现金；`Portfolio` 构造参数 `maxPositionAmountRatio` 已存在）② **组合层择时**（大盘状态 gate / 净值回撤熔断）；需**重新预注册**且必须带上述清查) |
| [`RESULT-TAIL-EXPLORE-001.md`](research/RESULT-TAIL-EXPLORE-001.md) | **右尾候选因子探索性扫描（探索性 · 非确认性 · 为 `9cp` 提供证据）**（只读；样本 joined **50,907**；靶 = **右尾**：`rd40≥+50%` 基线 2.74% / `rd60≥+100%` 基线 0.89%）。**发现**：① **`historicalLimitCount` 是唯一「可全期回测」的正向尾候选**（正向单调，Spearman +0.0278，最高分位 3.80% = **lift 1.39** vs 最低 0.89；覆盖 **100%**）；② `daysSincePreviousLimit` **负向**（最短 1.24 → 最长 **0.61**，最高/最低 2.04×；覆盖 96.1%）可作负向过滤；③ 🔴 **`sector` 信号最强但不可回测** —— 2026 年内 光通信 **12.99%（lift 3.61）** / 算力 **10.58%（2.94）** / AI硬件 **8.94%（2.49）**、`rd60≥+100%` 达 6.4~8.2%（全期基线 0.89%），但覆盖**仅约 1 年**（2019–2024 **0%**、2026 **96.6%**）且**只有 1 个 regime**，而这三个题材**恰是那一年主线** ⇒ **信号与「事后挑中当年最强题材」不可分离**（40 个题材里报 top-3，含选择偏差）；④ `turnover`/`sourceTurnoverAmount` 是**均值因子**（vs 收益 −0.118 / −0.136）**不是尾因子**；⑤ `marketCap`/`floatMarketCap` **100% 为 null** 不可测；⑥ 🔴 **3F 的反尾选择被强化确认**：Spearman(3F, `rd40≥+50%`) = **−0.0365**、**最低分位尾率 4.15%（1.51）是最高分位 1.94%（0.71）的 2.14 倍** ⇒ 3F 不是「找不到尾」而是「系统性避开尾」；**PIT 查证**：`sector` 命中键 = `(stockCode, limitUpDate)`（`datasetRegistry/db.ts:930`），有题材的 14,464 行来自 **2026-01~08 逐月同期采集**（100% 有题材），另有 **85,866 行 2026-09 一次性批量回填**（仅 1,966 有题材）⇒ **接近 PIT 而非当前快照**，但**当年没有该数据 ⇒ 无法补**；🔴 **§6 年度稳定性检验修正了 §1/§2 的推荐**：**`historicalLimitCount` 已降级/移除** —— 它是**累计量、随年份单调增长**，**年内归一化后仅 6/8 年同号、3/8 年单调**（2019 反向、2020/2023/2026 驼峰），**约 42% 表观信号来自年份漂移**，且对均值 −0.0685；**`daysSincePreviousLimit` 升为唯一通过年度检验的候选**（**8/8 年符号一致**、高/低比 8 年全 < 1、年内秩合并 Spearman **−0.0278** ≈ 未归一化的 −0.0274 ⇒ **无漂移污染**）；🔴 **贯穿性发现：尾部与均值在所有可用字段上反向**（`turnover` −0.122 / `sourceTurnoverAmount` −0.137 / `historicalLimitCount` −0.069 对均值均负；`gap` 是同一张力镜像）⇒ **任何臂必须同时报均值与尾部**；`9cp` 预注册应排除 `sector` 与市值假设、移除 `historicalLimitCount`、并以 `daysSincePreviousLimit` 长间隔排除为主臂) |
| [`PLAN-RESOLVING-RANK-3F-001.md`](research/PLAN-RESOLVING-RANK-3F-001.md) | **3F 排序分辨力实验（步骤 ①② 均已执行 · 结论：不接线连续分）**（起点：三因子桶数 **2/5/5** ⇒ 合成分**只有 18 档**、3 档覆盖 **86.9%**、Top-3 由 `securityId` 破平；**步骤 ①** 新增 `threeFactorContinuousScoreFeatures.ts` + 16 用例（边界由二分法从冻结 `bucketOf` 反解 ⇒ 不可能漂移、`result.ts` 一行未改；`t=0.5` 逐位等于现行公式 ⇒ 构造性 parity；**测试暴露并修掉了原方案末桶上界会重建并列的缺陷**，改无参数饱和映射；`check` 0 错 / 16/16 / `test:changed` 零新增失败 / EOL 0 / **未接线**）；**步骤 ②** 全候选池离线重放（eligible **50,907**，入场 rd6 open）：🔴 **修正既有结论** —— 冻结分 `rho` = **+0.0574(rd10) → +0.1116(rd60)**（原「零识别力」是在被截断的 1429 笔成交上算的，**总体错误**）；**但不识别右尾且轻微反向**（rd60 `>=+100%`：A=44 / B=37 / **D 无排序=58** / 底3=**70**）⇒ `maxAmplitude`/`meanAmplitude` 均 LOW 方向（偏好低振幅）而低振幅两侧尾部都更薄 ⇒ **分数改善均值、压低右尾，与盈利来源结构对立**；**「18 档量化是瓶颈」被否定**（连续化 rho 增量 ≤ 0.005，组合层更差）⇒ **不接线**；破平反转带来 +0.03~+0.52pp 的任意噪声（rd60） |
| [`RESULT-151PCT-WINNER-CONCENTRATION-001.md`](research/RESULT-151PCT-WINNER-CONCENTRATION-001.md) | **151% 策略赢家集中度分析（只读 · 执行两次被建议但从未执行的分析）**（`closed_loop_backtest_run` id `6210006`，逐笔 1434 条完整读取；**151.0958% = 9 笔交易的收益**：Top3 63.0% / Top5 89.0% / Top9 **120.2%**，剔除最好 9 笔 ⇒ −38.09%（报告收益口径 −75.84%）；中位单笔 **−275.90**、胜率 38.42%、Top10% 贡献 **438.7%**（其余 90% ≈ −641,784 元）；2025 单年 = 全期净利 61%，剔除 Top9 后 8 年仅 3 年为正；持仓 21–40 日的 **20 笔**贡献 95.5%；Runner 机制 38 笔贡献 64%；Top9 中 6 笔落在 OOS 窗口；**负结果：全 1434 笔 0 笔创业板/科创板 ⇒ K4「板块 limitRules 未注入」不能解释 151%**；`top5SharePct` 与系统持久化值小数点后 10 位一致（329.8662891131114%）；**差额已定性**：Σ`netPnl` 188,838 vs 权益增量 151,096 的 37,742 = `trades[].netPnl` 重复扣除卖出侧滑点（`portfolio.ts:288,304` + `cost.ts:50`，隐含 5.10bp vs 配置 5bp），**不影响 151.0958%**（出自现金台账）但影响 `profitFactor`/`concentration`/`returnPct`；**9 笔赢家全部可成交**（开盘 −0.06%~−3.17%、无一字板，`blockLimitUpBuys: true` 经 `assemble.ts:1178,1308` 生效，成交价 = 开盘 ×(1+5bp) 逐笔吻合）⇒ 排除执行幻觉；**选股层对右尾零识别力**（Spearman(`score`,`netPnl`) = −0.075、`>=+50%` 仅 2/9 在最高分位、2 笔赢家分数排到 1223/1326），根因是**结构性**：`score` = 三因子桶位分等权平均，而三因子被冻结成 **2/5/5** 档分桶（`maxAmplitude` 只贡献 1 bit）⇒ 合成分**只有 18 档**、**3 档覆盖 86.9%**、最高分并列 262 笔（18.3%）；破平键 = **`securityId.localeCompare`**（`ranking.ts:90`/`selection.ts:21`），事件 id 形如 `sec_<uuid>::event:…` ⇒ **档内次序由不透明 UUID 决定**；候选池实测**每天中位 35 个首板候选争 3 个名额**（`ds_first_limit_pullback_event` ds=780001：73,003 事件/1,863 日，**boardType 100% main** —— 从候选池表独立确认「0 笔创业板」）⇒ **Top-3 几乎总在同一分数档内**，**这解释了「加宽槽位 151%→−1.5% / 剔次新 −85.71pp / trend score −210pp」三个此前无机制的脆弱性观测**；**第四轮修正**（`PLAN-RESOLVING-RANK-3F-001` 步骤 ②，全池 50,836）：原「`Spearman=−0.075` ⇒ 零识别力」是在**被 Top-3 截断的 1429 笔成交**上算的、**总体错误**，正确总体下 `rho` = **+0.0574(rd10)→+0.1116(rd60)** 随持有期上升且显著 ⇒ **3F 是弱但真实的正向信号**；但**不识别右尾且轻微反向**（rd60 `>=+100%`：A=44 / B=37 / **D 无排序=58** / 底3=**70**）⇒ **分数改善均值、压低右尾，与盈利来源结构对立，151% 不是被分数选出来的**；**「18 档量化是瓶颈」被否定**（连续化增量 ≤0.005 ⇒ 不接线）；机制归因题材/上市龄/换手/分数全部无聚类，**唯一聚类是时间（6/9 在 2025–2026）⇒ regime 现象**；⚠️ 但**不可推论「3F 因子无效」**（信息在排名离散化处被丢弃）；结论对损益口径不敏感（三种口径 Top9 占比 120~155%、中位均为负）；基线 1.62.1 更极端（Top10% 1173.34%、MaxDD 持续 2,699 天）；不创建 Candidate） |

## 11. 归档区

| 归档区 | 归档日 | 份数 | 内容 | 索引 |
|---|---|---|---|---|
| `docs/archive/` | 2026-09-21 | 21 | 过期 plan / roadmap / todo / 阶段审计与设计快照 | [`archive/README.md`](archive/README.md)（含原路径对照表） |
| `docs/legacy/` | 2026-09-13 | 14 | 仓库根目录的非 `_*` 文件（含引用已废弃平台的指南） | [`legacy/README.md`](legacy/README.md) |
| `docs/legacy/phase-reports/` | 2026-09-17 | 59 | `docs/` 根目录的历史阶段报告（PHASE1 STEP2~5 的审计-修复轮次链） | [`legacy/phase-reports/README.md`](legacy/phase-reports/README.md) |

> 🔴 **两区并存**：`docs/legacy/`（2026-09-13/17）与 `docs/archive/`（2026-09-21）**语义相同**（都是「过期但保留」）；未合并的原因与代价见 `archive/README.md` §4。
> 📌 **归档判据**：R1 被取代 / R2 过期快照 / R3 未实施 plan / R4 零引用证据 —— 四条全文见 `archive/README.md` §1。默认是**归档而非删除**。
> ⚠️ **2026-10-07 例外**：22 份**机器本地**大体积证据（`docs/evidence/_analysis_*.json` 等，199.8 MB）经裁定删除 —— 它们被 `.gitignore` 锚定、**从未进入版本库**；引用处已标注「（已清理 2026-10-07）」，`ROADMAP-CHANGELOG.md` 按「历史条目零改写」保持原样。

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














- [现有首板滚动池续研：T+10内入场、权益比例仓位与固定Runner对照](research/GOAL-FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002.md) — 执行目标；先明确买点及执行尾部覆盖，旧池规则保持。

- [首板滚动池连续观察入场规则](research/RULE-FIRSTBOARD-ROLLING-OBSERVATION-ENTRY-001.md) — 每日观察分、连续稳定与突破确认；第一轮待验证配置。

- [首板滚动池：连续观察2/3/5日、T+20与再入场对照](research/GOAL-FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003.md) — 待执行目标0.2；四组主配置允许平仓后新买点再入场，另有五日/T+20的一次入场对照。

- [首板滚动池：T+20破位修复、每日ST禁买与快速闭环](research/GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md) — 待执行；原规则/修复规则两组、6账户预检、42账户探索研究，允许平仓后新信号再次入场。

- [滚动池实验执行时间优化方案](research/PLAN-ROLLING-POOL-EXECUTION-PERFORMANCE-001.md) — 阶段剖析、输入/装配复用与等价验收；取消完整矩阵的重复预检，缓存和并行按实测热点实施。
