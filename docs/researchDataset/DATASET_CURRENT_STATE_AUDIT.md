# DATASET_CURRENT_STATE_AUDIT — Research Dataset 现状审计

> 版本：v1.0 | 日期：2026-09-09 | 性质：**第一步交付物（只读审计，未修改任何代码/数据）**  
> 任务：`STEP — RESEARCH DATASET BUILDER PRODUCTIZATION & RESEARCH DATASET V2`  
> 证据优先级：真实 DB > 运行结果 > 代码 > 测试 > 文档 > 假设。本审计已实查 TiDB。

---


## 0. Executive Summary（一句话结论）

当前项目已经存在一套**成熟的后端 Research Dataset 基础设施**（C-12.6，`server/researchDataset/`，含 schema/version/fingerprint/9-policy/validation/persistence，且已有 20391 行真实数据集落库、两次构建 diff 为空、9 项 policy 冻结）；但存在**五条结构性缺口**，使其尚不能成为「可信、可复现、可审计、可版本化」的 Research Environment Contract：

1. **FE-3 仍是「最小冒烟构建器」**，只暴露 name / 日期 / PIT 模式 / 护栏，未实现任务要求的 8+ 维度筛选器。
2. **Validation 是三态（FAIL/PASS/INCONCLUSIVE）**，不是任务要求的 PASS/WARN/FAIL 分级。
3. **无显式语义版本（V1/V2/V3）**，只有 content-addressed 指纹版本；datasetVersion 未以「研究版本」身份进入 legacy Research Run。
4. **存在两条并行的 Dataset 概念**：C-12.6 `ResearchDataset`（完整）与 STEP 6.1 `ResearchDatasetSpec`（轻量 `{startDate,endDate,universe?,datasetVersion?}`）。Research Run 的真实执行路径（`runService → engineAdapter → runStrategyEngineBacktest`）走的是后者，**绕过了 C-12.6 完整 Dataset**。
5. **Industry 历史 PIT 是 CONDITIONAL**（effectiveFrom 单点 2026-08-31，当前快照，非历史序列），必须诚实标注，不能冒充历史行业筛选。

**结论**：后端骨架 `CODE_READY→VALIDATED`（P2-T1/T2/T3 已验证），前端与「研究运行强绑定」尚是 `PLANNED`。本 STEP 的核心工作是「把已就绪的后端能力，产品化为 8+ 维度的 Research Dataset Builder + 打通 Research Run 强绑定 + 补齐 Validation/Certification 分级 + 诚实标注 Industry 等 CONDITIONAL 能力」。

---

## 1. 审计方法

- **代码**：通读 `server/researchDataset/*`（13 文件）、`server/research/datasetAccess/*`（8 文件）、`server/research/signalEngine`、`server/research/simulator`、`server/research/closedLoop`、`server/researchDatasetRouter.ts`、`server/researchRouter.ts`、`server/researchRunRouter.ts`、`shared/researchContracts.ts`、FE-3（`client/src/pages/DatasetBuilder.tsx` + `client/src/components/dataset/*` + `client/src/adapters/datasetAdapter.ts`）。
- **文档**：`docs/quant-system-contract.md`、`docs/researchReadyGate/research_ready_gate.json`、`docs/MASTER_PRODUCT_ROADMAP.md`、`docs/MASTER_TASK_TRACKING.md`、`docs/quantRoadmap/reports/research-dataset-policies.md`、G2 证据（P2-T1/T2/T3）。
- **真实 DB**：TiDB Cloud 实查 `research_datasets`（2 行）、`__drizzle_migrations`（24 行）、`research_runs`（0 行）。

---


## 2. 现状盘点（按任务 §3 的 16 项重点）

# STEP DS-V2-FINAL — RESEARCH DATASET PRODUCTIZATION & INTEGRATION

# Research Dataset V2 产品化、研究链集成与真实 E2E

你刚刚已经完成 Dataset Current State Audit。

不要重新从零设计 Dataset。

本任务的目标是：

基于现有 Research Dataset 基础设施，  
完成：

FE-3 产品化  
\+  
Dataset Certification  
\+  
Research Run 强绑定  
\+  
Backtest 路径收敛  
\+  
Optimization/WFO Dataset Binding  
\+  
真实 Research E2E  
\+  
Gate 状态同步

最终把现有 Dataset 从：

“后端已有较完整基础设施”

升级为：

“可以作为正式量化研究实验环境使用的 Dataset”。

============================================================  
一、当前审计结论
========

已经确认：

1. research_datasets 表已存在
2. migration 0024 已落地
3. builder.ts 已存在
4. assemble / universe / db 已分层
5. researchDataset.build router 已存在
6. 9 类 policy 已冻结
7. fingerprint 已具备 SHA-256 确定性
8. Dataset 当前采用 content-addressed immutable identity
9. FE-3 目前只有最小化构建器
10. Dataset → simulator 已接通
11. Dataset → signalEngine 已接通
12. research_runs 当前为 0
13. Optimization/WFO 仍存在 legacy path
14. Industry historical PIT 不完整
15. Research Ready Gate snapshot 存在滞后
16. researchDataset 已有 37 个单测

因此：

不要推倒重做。

优先做：

INTEGRATION  
\+  
PRODUCTIZATION  
\+  
E2E EVIDENCE

============================================================  
二、重要设计决策
========

不要机械修改已有设计。

尤其：

1. Validation 保留三态：

PASS  
FAIL  
INCONCLUSIVE

不要为了形式统一强制改成：

PASS/WARN/FAIL。

因为：

INCONCLUSIVE  
代表：

证据不足，不能证明安全。

这对于研究系统比 WARN 更严格。

1. Dataset Version 当前：

content-addressed immutable

例如：

rd-<builder>-<rowSchema>-<16hex>

保留这个设计。

不要为了增加 V1/V2/V3 而破坏现有 identity。

如果确有产品需要：

增加：

datasetFamily  
semanticVersion

但：

immutable datasetId/version identity  
必须继续保持。

1. Industry：

当前历史 PIT 数据不足。

必须：

CONDITIONAL

不得伪造 READY。

============================================================  
三、P0：FE-3 Dataset Builder 产品化
=============================

重新实现：

DatasetBuilder

DatasetConfigPanel

但必须基于后端已有：

policy  
capability  
validation  
builder

不能在前端自己实现研究语义。

Dataset Builder 至少展示：

01 Basic  
02 Date Range  
03 Universe  
04 Historical Security State  
05 Market / Board / Industry  
06 Liquidity / Market Cap  
07 Price / Corporate Action  
08 PIT / Survivorship  
09 Execution / Cost / Slippage  
10 Market Context

每一个能力必须显示：

AVAILABLE  
CONDITIONAL  
UNAVAILABLE

不能仅根据 UI 是否存在决定状态。

状态必须来自 Backend Capability。

============================================================  
四、FE-3 必须实现 Dataset Preview
===========================

选择配置后：

不要直接生成 Dataset。

先：

Validate

然后：

Preview

至少显示：

Date Range  
Universe  
Security Count  
Estimated Bar Count  
PIT Status  
Survivorship Status  
Historical State Status  
Industry Status  
Liquidity Status  
Corporate Action Status  
Data Quality Status

并显示：

PASS  
FAIL  
INCONCLUSIVE

============================================================  
五、Certification
===============

Dataset 创建流程：

CONFIGURE  
↓  
VALIDATE  
↓  
PREVIEW  
↓  
CERTIFY  
↓  
CREATE IMMUTABLE VERSION

只有满足正式研究要求：

才允许：

CERTIFIED

如果存在：

INCONCLUSIVE

必须：

CONDITIONAL

不能：

CERTIFIED

如果：

FAIL

必须：

REJECTED

============================================================  
六、Dataset Fingerprint
=====================

保留现有：

datasetVersion  
rowsFingerprint  
policySetFingerprint  
versionSnapshotFingerprint

确保：

相同 Dataset Specification  
\+  
相同 Source Version  
\+  
相同 Policy

得到：

相同 Fingerprint。

任何关键 Dataset 变化：

Fingerprint 必须变化。

增加测试：

Fingerprint Determinism Test

Fingerprint Mutation Test

============================================================  
七、Dataset 与 Research Run 强绑定
============================

所有正式 Research Run 必须记录：

datasetId  
datasetVersion  
datasetFingerprint

以及：

strategyId  
strategyVersion  
codeVersion  
parameters

必须形成：

Research Run Identity

：

Dataset  
\+  
Strategy  
\+  
Code  
\+  
Parameters

Research Run 创建后：

Dataset 不允许被修改。

============================================================  
八、P0：真实 Research E2E
====================

这是本 STEP 的核心验收。

当前：

research_runs = 0

必须创建至少一个真实：

Research Run

禁止 Mock。

必须使用当前真实历史数据。

流程：

Dataset  
↓  
Dataset Validation  
↓  
Dataset Certification  
↓  
Strategy  
↓  
DatasetAccess  
↓  
Signal Engine  
↓  
Position Intent  
↓  
Simulator / Backtest  
↓  
Metrics  
↓  
Research Run  
↓  
Persist Result

最终数据库必须存在：

research_run

以及完整 lineage。

============================================================  
九、Backtest 路径
=============

当前：

Dataset → C-14.1 simulator

已经正确。

但是：

legacy engineAdapter

仍然存在绕过 Dataset 的路径。

不要立即删除。

先分类：

FORMAL RESEARCH  
TECHNICAL PREVIEW  
LEGACY COMPATIBILITY

最终要求：

正式研究：

必须：

Dataset  
↓  
DatasetAccess  
↓  
Research Engine  
↓  
Backtest

Legacy：

只能：

Technical Preview / Compatibility

不得作为：

Research Evidence

============================================================  
十、Optimization Dataset Binding
==============================

重点审计：

paramSearchRouter

walkForwardRouter

robustness

stochastic

必须回答：

它们是否真正使用：

Research Dataset？

如果不是：

修改。

最终：

Parameter Search：

Dataset V1  
\+  
Strategy V1  
\+  
Parameter Set

Robustness：

Dataset V1  
\+  
Strategy V1  
\+  
Perturbation

WFO：

Dataset V1  
\+  
Train Window  
\+  
Validation Window  
\+  
OOS Window

OOS：

必须使用严格未参与优化的数据。

============================================================  
十一、禁止 OOS 污染
============

必须测试：

Optimization 不允许读取 OOS 数据。

Parameter Search 不允许读取 OOS 数据。

WFO 不能使用未来窗口。

OOS 只能在模型确定后运行。

增加：

OOS Contamination Test

============================================================  
十二、Industry
===========

当前：

Industry = 5212 rows

effectiveFrom 主要为：

2026-08-31

因此：

Historical Industry PIT

必须：

CONDITIONAL

不得：

READY

如果 Dataset 不依赖 Industry：

可以：

CERTIFIED

如果 Dataset 明确依赖历史 Industry：

必须：

CONDITIONAL

直到真实历史行业序列建立。

============================================================  
十三、Liquidity / Market Cap
=========================

审计当前真实历史覆盖。

分别确定：

Market Cap  
Free Float Market Cap  
Average Amount  
Average Volume  
Turnover

必须输出：

AVAILABLE  
CONDITIONAL  
UNAVAILABLE

不要因为有字段就认为历史数据可用。

必须检查：

date coverage  
PIT  
security coverage

============================================================  
十四、Historical Universe
======================

必须确认：

Current Universe

和：

Historical Universe

完全区分。

不得：

用今天股票池回测历史。

测试：

Survivorship Bias

例如：

已退市股票是否能够出现在其历史存续期间。

============================================================  
十五、Research Ready Gate
======================

重新检查：

research_ready_gate.json

scripts/step12_certify_gate.mjs

当前 Gate snapshot 可能滞后。

必须重新生成真实 snapshot。

不要：

修改 gate 条件来让结果 PASS。

必须：

代码真实状态  
→ Gate  
→ Snapshot

最终明确：

DATA_FOUNDATION_READY  
HISTORICAL_STATE_READY  
DATASET_READY  
RESEARCH_ENGINE_READY  
RESEARCH_READY  
PRODUCTION_READY

不要把：

Dataset Certified

直接等同：

Research Ready。

============================================================  
十六、FE-3 不允许出现 Mock
==================

禁止：

mock dataset  
mock statistics  
fake capability  
fake validation  
fake certification  
hardcoded PASS

所有 Preview：

必须来自 API。

============================================================  
十七、性能要求
=======

不能每次打开 FE-3：

全表扫描 8M+ OHLCV。

使用：

metadata  
indexed statistics  
cached validation  
async validation

Preview 要快速返回。

深度 Validation 可以异步。

============================================================  
十八、测试
=====

必须完成：

Dataset Unit Tests

Dataset Integration Tests

Dataset Router Tests

Dataset Certification Tests

Dataset Fingerprint Tests

Research Run Integration Tests

DatasetAccess Tests

Backtest Integration Tests

Optimization Dataset Binding Tests

WFO Dataset Binding Tests

OOS Contamination Tests

Survivorship Tests

PIT Tests

Date Boundary Tests

Industry Conditional Tests

============================================================  
十九、真实数据验收
=========

至少执行一次：

REAL DATASET CERTIFICATION

建议：

2019-01-02  
~  
2026-09-04

实际范围必须服从：

canonical trading calendar

以及：

data quality。

必须输出：

datasetId  
datasetVersion  
fingerprint  
universe count  
bar count  
coverage  
PIT status  
survivorship status  
historical state status  
corporate action status  
industry status  
liquidity status  
validation result

============================================================  
二十、最终 Research E2E
==================

必须真正跑通：

USER HYPOTHESIS  
↓  
STRATEGY V1  
↓  
DATASET V1  
↓  
DATASET CERTIFICATION  
↓  
BASELINE RUN  
↓  
METRICS  
↓  
PARAMETER SEARCH  
↓  
ROBUSTNESS  
↓  
WFO  
↓  
OOS  
↓  
OVERFITTING  
↓  
REGIME  
↓  
VERDICT

本 STEP 至少要求：

Dataset  
\+  
Baseline Research Run

真实跑通。

Optimization/WFO 如果当前架构尚未完全迁移：

必须明确：

CODE_READY  
或  
INTEGRATION_PENDING

绝不能伪造：

RESEARCH_READY。

============================================================  
二十一、最终文档
========

创建/更新：

docs/researchDataset/DATASET_CAPABILITY_MATRIX.md

docs/researchDataset/DATASET_SPECIFICATION.md

docs/researchDataset/DATASET_CERTIFICATION_SPEC.md

docs/researchDataset/DATASET_VERSIONING.md

docs/MASTER_PRODUCT_ROADMAP.md

docs/MASTER_TASK_TRACKING.md

最终报告：

docs/RESEARCH_DATASET_V2_IMPLEMENTATION_REPORT.md

============================================================  
二十二、最终报告必须回答
============

1. Dataset 当前到底能做什么？
2. 哪些能力已经真实可用？
3. 哪些能力 CONDITIONAL？
4. 哪些能力不可用？
5. Dataset 是否 PIT-safe？
6. Dataset 是否 survivorship-safe？
7. Dataset 是否 immutable？
8. Fingerprint 是否 deterministic？
9. Research Run 是否绑定 Dataset？
10. Backtest 是否存在 Dataset bypass？
11. Optimization 是否绑定 Dataset？
12. WFO 是否绑定 Dataset？
13. OOS 是否隔离？
14. Industry 是否存在历史数据问题？
15. Liquidity 是否有真实历史覆盖？
16. Market Cap 是否有真实历史覆盖？
17. FE-3 是否已经成为正式 Dataset Builder？
18. 是否跑通真实 Research E2E？
19. Research Ready Gate 是否与实际状态一致？
20. 当前剩余最大风险是什么？

============================================================  
二十三、最终状态模型
==========

每一个能力必须分别记录：

CONTRACT_DEFINED  
CODE_READY  
TESTED  
VALIDATED  
INTEGRATED  
CERTIFIED  
RESEARCH_READY

禁止：

CODE_READY = RESEARCH_READY

禁止：

TEST PASS = CERTIFIED

禁止：

UI 可选择 = DATA AVAILABLE

禁止：

数据库有字段 = HISTORICAL DATA AVAILABLE

============================================================  
二十四、执行顺序
========

严格按照：

STEP 1  
Current Audit  
↓

STEP 2  
Capability Matrix  
↓

STEP 3  
FE-3 Productization  
↓

STEP 4  
Certification  
↓

STEP 5  
Research Run Binding  
↓

STEP 6  
Backtest Path Audit  
↓

STEP 7  
Optimization/WFO Binding  
↓

STEP 8  
Real Data Validation  
↓

STEP 9  
Real Research E2E  
↓

STEP 10  
Gate Refresh  
↓

STEP 11  
Final Audit

每一步：

测试  
→ 记录证据  
→ 更新 Task Tracking  
→ 再进入下一步。

============================================================  
二十五、完成标准
========

本 STEP 不以：

“FE-3 页面完成”

作为完成条件。

真正完成条件：

用户可以：

创建一个正式 Dataset

↓

通过 Validation

↓

获得 Certification

↓

产生 immutable Dataset Version

↓

获得 deterministic Fingerprint

↓

创建 Strategy

↓

运行 Research Run

↓

Backtest 使用 Dataset

↓

产生 Metrics

↓

Research Run 持久化 Dataset lineage

并且：

没有 Mock  
没有 Fake PASS  
没有未来数据泄漏  
没有 survivorship bias  
没有 Dataset silent mutation  
没有 OOS contamination。

最终形成：

一个真正可信的：

Research Dataset → Research Run

基础闭环。

现在开始执行。

第一阶段先完成：

Current Audit  
\+  
Capability Matrix  
\+  
Implementation Plan

然后再实施代码。

不要重新设计已有成熟模块。

优先复用现有：

researchDataset  
builder  
policy  
version  
versionSnapshot  
datasetAccess  
simulator  
signalEngine

最终目标：

让 Research Dataset 成为整个量化系统唯一可信的研究实验环境。



---

## 3. 逐项回答 A–M（任务 §3 强制回答）


### A. 当前 Dataset 已经具备什么？

- **完整后端领域模型**（`server/researchDataset/types.ts`）：`ResearchDatasetRequest` / `ResearchDatasetRow`（标准宽行，8 类字段：identity/lifecycle/tradability/industry/liquidity/price/corporate-action/market-state/knowledge）/ `UniverseDefinition` / `DataSnapshot` / `ResearchDataset`（artifact）。
- **确定性版本 + 指纹**（`version.ts` / `versionSnapshot.ts`）：canonical JSON（键字典序）+ SHA-256；`datasetVersion`、`rowsFingerprint`、`policySetFingerprint`、`versionSnapshotFingerprint` 四层，已验证「同输入必同指纹、内容变则指纹变」。
- **逐日 PIT + Survivorship-safe Universe**（`universe.ts` → STEP 11 `resolveHistoricalUniverse`）：LISTING/TRADING 正向确认、SUSPENSION/DELISTING 负向阻断、UNKNOWN 默认拒绝；B Master 全表加载（含 337 退市股）。
- **9 类 policy 冻结**（`policy.ts` + `policyValidate.ts`）：4 层一致性校验（齐备/形状/声明值 vs 期望值/交叉语义）。
- **真实 DB 加载 + 持久化**（`db.ts` / `persist.ts`）：逐日批量拉取、幂等落库（`DS-<datasetVersion>` 唯一）。
- **访问层适配**（`datasetAccess/*`，C-13.1）：`bindResearchDataset`（PIT/排序不变量）、`createDatasetSession`（版本/universeId/窗口一致）、`createDatasetDataSource`/`createDatasetUniverseProvider`（→ framework 契约）。
- **研究链消费**（`signalEngine` C-13.2 → `simulator` C-14.1 → `metrics` C-16.x）：产物（CandidateEvaluationRun / TradeSimulationRun）均记录 `datasetVersion`。

### B. 当前 Dataset 缺什么？

1. **FE-3 维度缺失**：Universe 模式（Historical/Current/Custom、市场/板块/指数成分/自定义）、Historical State（ST/*ST/停牌/退市/IPO/上市天数/风险警示）、Industry 选择、Liquidity/Market Cap 筛选（市值/流通市值/换手/成交额/成交量 + 5/10/20/60D 窗口）、Price/CA 策略、Data Quality 策略、Execution/Cost/Slippage、Market Context（Regime）—— **均无 UI，也无对应 Dataset 请求字段**。
2. **Validation 分级缺失**：现为 FAIL/PASS/INCONCLUSIVE，任务要求 PASS/WARN/FAIL。
3. **语义版本缺失**：无 V1/V2/V3；`datasetId = DS-<content-hash>` 是内容寻址，不是「研究版本」身份。
4. **Lineage 未落为独立字段**：versionSnapshot 有 builder/rowSchema/policySchema 版本，但**未显式记录** source tables / source data versions / migration version / creator / code version。
5. **Research Run 未强绑定**：`ResearchDatasetSpec.datasetVersion` 是 optional，且注释已过期（「当前系统无数据集版本机制时必须保持 undefined」——现在机制已存在）。
6. **Certification 未实现**：无 `DATASET_CERTIFIED / CONDITIONAL / REJECTED` 判定链（Data Foundation Gate + Validation + PIT + Universe + Reproducibility）。
7. **Future Leakage 专项测试缺失**：`assertRowPitInvariant` 有（asOf===tradeDate），但无「研究日 2023-01-01 不能读 2023-01-02 之后信息」的端到端测试。

### C. 哪些筛选项已有真实数据支持？

| 筛选项                        | 真实数据                                            | PIT 安全                  | 结论                           |
| -------------------------- | ----------------------------------------------- | ----------------------- | ---------------------------- |
| Date Range                 | ✅ index_daily 1863 交易日日历                        | ✅                       | READY                        |
| PIT 模式（逐日/固定 asOf）         | ✅                                               | ✅                       | READY                        |
| Universe（全 A 股 PIT 成员决议）   | ✅ Master 5552 + Status 10373                    | ✅                       | READY（但无用户可选子集维度）            |
| ST / 停牌 / 退市（作为排除）         | ✅ Status：SUSPENDED 1830 / ST 734 / TRADING 5552 | ✅                       | READY（语义在 universe 层，无独立 UI） |
| Liquidity（换手/流通市值/总市值/额/量） | ✅ liquidity_daily 9.01M 行                       | ✅（tradeDate 日级事实）       | READY（数据层）                   |
| Corporate Action（事件计数/可知性） | ✅ 31641 事件 + 31337 复权因子                         | ✅（announcementDate PIT） | READY（数据层）                   |

### D. 哪些筛选项只有代码接口、没有真实历史数据？

| 筛选项                                              | 代码接口                                                              | 真实历史数据                                            | 缺口                    |
| ------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------- | --------------------- |
| Industry（历史行业序列）                                 | ✅ `industry` policy + `industryCode/Name` 字段                      | ❌ 仅当前快照（effectiveFrom 单点 2026-08-31）              | **无历史 PIT 序列**        |
| Adjusted Price（复权价）                              | ⚠️ 仅 `priceBasis="raw"`；schema 禁止宣称 adjusted                      | ❌ 有 adjustment_factors 但 Derived Layer 未进 dataset | 复权为 Derived Layer，未物化 |
| Market Context / Regime（Breadth/Sentiment/涨停家数等） | ⚠️ `marketRegime` 模块存在（Trend/Volatility 已有；Breadth/Sentiment 待验证） | ❌/PARTIAL                                         | 未接入 dataset           |
| Minute / Tick                                    | ❌ 无                                                               | ❌ 无分钟数据                                           | 不开放                   |

### E. 哪些筛选项目前绝对不能开放？

1. **Industry 历史筛选**——只有当前快照，开放即「当前行业冒充历史行业」（Survivorship + PIT 双重破坏）。
2. **Adjusted Price 筛选**——Derived Layer 未 PIT 物化，开放即前视泄漏。
3. **Minute / Tick**——无底层分钟数据。
4. **Breadth / Sentiment / Market Context**——无真实历史数据，开放即伪造。
5. **任何「固定 asOf 快照」冒充「逐日 PIT 研究」**——固定快照只允许调试/审计，研究必须逐日 PIT（§4/§9 铁律）。

### F. Dataset 是否真正被 Backtest 使用？

**部分使用。**

- ✅ **C-14.1 `simulator`**（多日交易模拟）：`bindResearchDataset(dataset)` + `rowToCanonicalBar`，真正消费 C-12.6 Dataset 行，产出 Trade/Equity。
- ❌ **legacy 路径 `engineAdapter.ts → runStrategyEngineBacktest`**：`ResearchDataLoader` 直接加载 `LeaderCandidateSourceRecord[] + RawDailyPriceRow[]`（自然键），**不经过 C-12.6 Dataset**。这条路径是 `ResearchRunService.runExperiment` 的真实执行路径。

### G. Dataset 是否真正被 Research Engine 使用？

**部分使用（CODE_READY，未真实 E2E）。**

- ✅ `signalEngine/engine.ts` 用 `createDatasetSession(dataset, config)` 逐日驱动 STEP 10 pipeline。
- ❌ 但 `researchRunRouter` 恒定 `executorBound=false`，`research_runs=0`——**尚无一次真实端到端研究运行消费 Dataset**。

### H. Dataset Version 是否真正参与研究结果身份？

**部分参与。**

- ✅ `CandidateEvaluationRun` / `TradeSimulationRun`（C-13.2/C-14.1 产物）都记录 `datasetVersion`，`ExperimentConfig.datasetVersion` 与句柄强校验（`assertDatasetVersionConsistent`）。
- ❌ **legacy `ResearchRun`**（STEP 6.2 实体）只记录 `experimentId` + `ResearchDatasetSpec{startDate,endDate,universe?,datasetVersion?}`，`datasetVersion` 未强制、未进 Run 身份、未进 fingerprint。

### I. Fingerprint 是否可信？

**可信。** SHA-256 canonical（键字典序）序列化，纯函数无瞬时字段；P2-T2 已用真实 DB 验证「两次构建 datasetVersion/rowsFingerprint/policySetFingerprint 完全一致（diff 为空）」。`versionSnapshotFingerprint` 可 round-trip 校验防篡改。

### J. 是否存在未来数据泄漏风险？

- ✅ **核心链路无泄漏**：`bindResearchDataset` 绑定期断言每行 `asOf === tradeDate`；`datasetAccess/invariants.ts` 单一事实来源；`resolveHistoricalUniverse` 逐日 PIT；CA `announcementDate <= asOf`。
- ⚠️ **legacy engineAdapter 路径**的 PIT 安全取决于 `ResearchDataLoader` 的实现（直接喂 `RawDailyPriceRow`），**不经过 bindResearchDataset 的 PIT 断言**——这是当前唯一的泄漏敞口。
- ⚠️ Industry `retrievedAt <= asOf` 过滤存在，但因无历史区间，实际等于「全窗口 null」。

### K. 是否存在 survivorship bias？

**核心链路无。** B Master 全表加载（含 337 退市股），成员按生命周期 PIT 决议，退市后不渲染 eligible 行。G0「Survivorship validation」PASS（delistedCount=337）。

### L. 是否存在 PIT 问题？

**Industry 唯一 PIT 问题**（§19 已点名）：industry_assignments `effectiveFrom` 单点 2026-08-31，无法构成 2019-2026 历史行业序列。已在 policy/快照/gate 中诚实标注 `CONDITIONAL`（G1 GAP）。

### M. 是否存在当前快照冒充历史数据的问题？

**Industry 一处**：`industryAssignments` 是当前快照（effectiveFrom 2026-08-31），builder 用 `retrievedAt<=asOf` 过滤后，2019-2024 行 `industryCode/Name = null + knowledge.UNKNOWN`（**不伪造**）。这是「诚实缺失」，不是「冒充」。但 UI 若开放 Industry 筛选，就会变成「冒充」。

---


## 4. 最终 20 问自答（任务 §28）

1. **Dataset 定义了什么？** 逐日 PIT 的研究数据面板：universe_definition + 标准宽行 + 9 类 policy + data_snapshot + 确定性版本/指纹。它是「研究环境定义」，不是数据副本（无 dataset_bars 复制表）。
2. **与 Strategy 的边界？** Dataset 不含任何交易信号逻辑；策略（涨停后买入/连板/龙头）在 `strategy/` 与 `signalEngine` 层。
3. **与 Backtest 的边界？** Dataset 不产 Order/Fill/Portfolio；Backtest（simulator/STEP8）消费 Dataset 行。但 legacy engineAdapter 路径绕过 Dataset，是待补的边界缺口。
4. **是否真的不可变？** 是（content-addressed + 幂等唯一键 + 不改历史）。但无 V1/V2/V3 语义版本。
5. **Fingerprint 是否可信？** 可信（P2-T2 真实 DB 验证）。
6. **是否 PIT-safe？** 核心链路是；legacy 路径待补。
7. **是否 survivorship-safe？** 是（337 退市股全含）。
8. **是否当前数据冒充历史？** Industry 存在「当前快照」风险，已诚实标注 CONDITIONAL。
9. **Industry 能否用于历史研究？** **不能**（无历史 PIT），除非 Dataset 显式声明「Industry 不参与研究」。
10. **Liquidity 是否有历史数据？** 有（9.01M 行，1992-2026），PIT 安全（tradeDate 日级事实）。
11. **Market Cap 是否有历史数据？** 有（liquidity_daily 的 circulationMarketCap/totalMarketCap），但非独立域，随 liquidity 域提供。
12. **是否被 Research Engine 使用？** 部分（signalEngine 已接，未真实 E2E）。
13. **是否被 Backtest 使用？** 部分（simulator 用，legacy engineAdapter 不用）。
14. **Research Run 是否记录 Dataset Version？** **否**（legacy Run 未强制；Candidate/Trade 产物记录）。
15. **能否复现历史研究结果？** 理论上能（确定性版本/指纹 + 幂等），但因 research_runs=0 且 legacy 路径无版本绑定，**尚未端到端证明**。
16. **FE-3 是 UI 还是正式 Builder？** **当前是 UI 壳**（最小冒烟构建器），不是 8+ 维度的正式 Builder。
17. **有没有 Mock？** 无。`buildResearchDataset` 纯真实 DB；DB 不可用返回 INCONCLUSIVE + 空 rows（不伪造）。
18. **有没有 Fake PASS？** 无。gate 老实三态，`dataReady=false` 时绝不 PASS。但「G2 表已落地」与 gate json「ER_NO_SUCH_TABLE」存在文档滞后（gate json 生成于 12:58，迁移 21:46 落地）。
19. **有没有绕过 Dataset 的研究路径？** **有**：legacy `engineAdapter → runStrategyEngineBacktest`（runService 真实路径），用 `ResearchDatasetSpec` + 直接 DB 加载，绕过 C-12.6 Dataset。
20. **当前最大的 Dataset 风险？** **「双 Dataset 概念并行」**——C-12.6 完整 Dataset 与 STEP 6.1 轻量 Spec 并存，Research Run 走的是轻量路径，导致「Run A 页面显示 Dataset V1、实际用另外的数据」的风险在本项目里是**真实存在的结构性缺口**（而非仅 UI 问题）。

---

## 5. 当前真实数据覆盖快照（实查 + gate）

| 域                    | 规模                                            | 覆盖                              | 状态                               |
| -------------------- | --------------------------------------------- | ------------------------------- | -------------------------------- |
| A OHLCV              | 8,891,942 行（2019-01-02 ~ 2026-09-09）          | 1866/1863 交易日，0 缺口              | FULL                             |
| B Security Master    | 5552（含 337 退市）                                | 5500+                           | FULL                             |
| C Status             | 10373（SUSPENDED 1830 + ST 734 + TRADING 5552） | 1500+                           | FULL                             |
| D Corporate Actions  | 31,641 事件                                     | 4824 只                          | FULL                             |
| E Liquidity          | 9,015,158 行                                   | 5131 只                          | FULL                             |
| F Index              | 7452 行（4 核心指数 × 1863 日）                       | 4 指数                            | FULL                             |
| G Industry           | 5212 行                                        | **effectiveFrom 单点 2026-08-31** | **CONDITIONAL（无历史 PIT）**         |
| H Adjustment Factors | 31,337 行                                      | 5025 只                          | FULL（Derived Layer 未物化进 dataset） |
| research_datasets    | 2 行（1 条 20391 行 + 1 条 0 行遗留）                  | —                               | 表已落地                             |
| research_runs        | 0 行                                           | —                               | 无真实 E2E                          |

---

## 6. 架构现状图（两套并行 Dataset 概念）

```
【路径 A：完整 Research Dataset（C-12.6 → C-13 → C-14 → C-16）】
buildResearchDataset (C-12.6)
   → datasetAccess bindResearchDataset / createDatasetSession (C-13.1)
   → signalEngine runCandidateEngine (C-13.2)  [记录 datasetVersion ✓]
   → simulator runTradeSimulation (C-14.1)     [记录 datasetVersion ✓]
   → metrics C-16.x
状态：CODE_READY（测试通过），未真实 E2E（research_runs=0）

【路径 B：legacy Research Run（STEP 6.2，绕过 C-12.6）】
createExperiment (ResearchDatasetSpec{startDate,endDate,universe?,datasetVersion?})
   → runService.runExperiment → engineAdapter.runResearchBacktest
   → runStrategyEngineBacktest (STEP 8 生产策略引擎)
   → ResearchDataLoader 直接加载 LeaderCandidateSourceRecord + RawDailyPriceRow
状态：CODE_READY，datasetVersion 未强制、未进 Run 身份，executorBound=false
```

**核心 Gap**：正式研究链路（路径 B）**没有**强绑定 C-12.6 Dataset 版本；而强绑定 Dataset 版本的链路（路径 A）**尚未接通真实运行**。
