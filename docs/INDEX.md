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













