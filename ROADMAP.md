# QUANT RESEARCH MASTER CONTROL SPEC V2

> **目录**：见下方一级标题；本文件是项目**唯一 Master Control**。
> 🔴 铁律：§44 为「覆盖式」状态区（**只保留最近 1 条「上轮实查」**，历史条目在 `ROADMAP-CHANGELOG.md`）；§44.5 为**未完成**队列（编号按「下一个未占用」，已用至 `9ci`）；§47 为 append-only 更新记录。
> 逐字节原文备份（2026-09-15 整理前）：`.cache/ROADMAP.md.before-cleanup-20260915`。

## 0. 任务身份

你现在负责维护项目：

`stock-limit-up-analyzer`

这是一个正在从「涨停/股票分析应用」升级为「个人量化策略研究平台」的项目。

本文件不是普通 README，也不是开发说明，而是：

> **整个量化系统后续开发、验证、数据建设、研究和交付的唯一 Master Control Spec。**

后续所有 Work、Agent、开发任务、修复任务、数据任务、Research 任务，都必须以本文件为最高级项目路线依据。

---

# 1. 当前项目最终目标

项目最终不是简单的股票分析网站，而是建立一个：

> **基于真实历史数据、PIT、Survivorship Bias 防护、历史市场状态重建、策略回测、参数优化、稳健性验证、OOS/WFA、过拟合检测、模拟交易和交易纪律反馈的个人量化研究平台。**

核心闭环：

```text
真实历史数据
    ↓
数据标准化
    ↓
Security Identity
    ↓
Historical State Reconstruction
    ↓
Research Dataset
    ↓
Strategy Definition
    ↓
Signal
    ↓
Backtest
    ↓
Evaluation
    ↓
Parameter Optimization
    ↓
Robustness Testing
    ↓
Walk-Forward / OOS
    ↓
Overfitting Detection
    ↓
Strategy Versioning
    ↓
Market Regime
    ↓
Paper Trading
    ↓
Trading Review
    ↓
Trading Discipline
    ↓
真实交易反馈
    ↓
再次 Research
```

最终目标：

```text
主观交易经验
      ↓
明确规则
      ↓
程序化策略
      ↓
历史验证
      ↓
参数优化
      ↓
稳健性验证
      ↓
样本外验证
      ↓
过拟合检测
      ↓
模拟交易
      ↓
交易纪律
      ↓
可执行交易规则
```

---

# 2. 不可违背的系统铁律

以下规则为项目最高优先级。

## 2.1 正确性优先级

严格遵循：

```text
正确性
>
数据真实性
>
PIT 正确性
>
Survivorship 正确性
>
可复现性
>
架构完整性
>
测试覆盖
>
开发速度
```

不得为了：

- 快速完成
- UI 展示
- Demo
- 测试通过
- 代码数量
- Work 完成数量

牺牲研究可信度。

---

# 3. Evidence Hierarchy

发生冲突时严格按照：

```text
真实 DB 状态
>
实际运行结果
>
实际代码
>
自动化测试
>
文档
>
设计假设
```

禁止：

```text
mock 数据
```

冒充真实数据。

禁止：

```text
provider 可以获取
```

冒充：

```text
历史数据已经回填
```

禁止：

```text
代码支持
```

冒充：

```text
数据库已有真实数据
```

禁止没有证据将：

```text
DATA-PENDING
```

标记为：

```text
PASS
```

---

# 4. PIT 铁律

任何历史研究、回测、指标计算必须满足：

```text
asOf(T)
```

只能看到：

> T 时刻已经可获得的信息。

禁止未来信息进入过去。

必须特别检查：

```text
Corporate Actions
Industry
Security Status
Financial Data
Index Membership
Liquidity
Trading Status
Delisting
Listing
Identifier Changes
```

必须考虑：

```text
announcement_time
effective_time
available_time
```

不能只依赖数据库记录时间。

---

# 5. Survivorship Bias 铁律

历史股票池禁止直接使用当前股票列表。

必须使用：

```text
Security Master
+
Identifier History
+
Status History
+
Listing History
+
Delisting History
```

动态重建历史股票池。

必须保证：

```text
退市股票
```

可以出现在它实际存在的历史时期。

同时：

```text
上市之前
```

不能出现在历史股票池。

```text
退市之后
```

不能继续出现。

---

# 6. Security Identity 铁律

任何股票身份相关逻辑必须考虑：

```text
canonical identity
stock code
identifier history
code reuse
listing
delisting
name change
ticker change
```

禁止仅使用：

```text
stockCode
```

作为永久身份。

必须能够处理：

```text
同一证券代码变化
代码复用
证券更名
上市
退市
历史证券
```

---

# 7. 系统状态模型

以后禁止只使用：

```text
Done
Partial
Pending
```

作为唯一状态。

统一采用：

```text
DESIGN
CODE_READY
DATA_READY
VALIDATED
RESEARCH_READY
PRODUCTION_READY
BLOCKED
```

定义：

### DESIGN

设计完成，但尚未实现。

### CODE_READY

代码已经实现，但可能：

- 没有真实数据
- 没有完成验证
- 没有通过研究 Gate

### DATA_READY

真实数据已经接入，并满足最低数据完整性要求。

### VALIDATED

代码、数据、边界条件、测试已经验证。

### RESEARCH_READY

可以用于正式量化研究。

### PRODUCTION_READY

已经满足生产级运行要求。

### BLOCKED

存在明确阻塞依赖。

---

# 8. Master Roadmap

整个项目统一采用：

```text
STEP 12
Historical Data Foundation
        ↓
STEP 12.5
Historical State Reconstruction
        ↓
STEP 12.6
Research Dataset Certification
        ↓
STEP 13
Research Engine
        ↓
STEP 14
Backtest Engine
        ↓
STEP 15
Strategy Definition + Initial Versioning
        ↓
（STRATEGY-001 ✅ 能力审计 → STRATEGY-002 ✅ 持久化与 CRUD 闭环
  → STRATEGY-003 ✅ Domain Model & Persistence Architecture
  → STRATEGY-004 建议：Definition 消费侧（可执行解析 / 绑定引用完整性 / 状态机接入））
        ↓
STEP 16
Strategy Evaluation
        ↓
STEP 17
Parameter Optimization
        ↓
STEP 18
Robustness Testing
        ↓
STEP 19
Walk-Forward / OOS
        ↓
STEP 20
Overfitting Detection
        ↓
STEP 21
Strategy Lifecycle Management
        ↓
STEP 22
Market Regime Analysis
        ↓
STEP 23
Paper Trading
        ↓
STEP 24
Trading Review / Discipline
        ↓
STEP 25
Production Quant Platform
```

---

# 9. STEP 12 — Historical Data Foundation

当前阶段。

目标：

建立可信的历史数据地基。

数据域：

```text
A OHLCV
B Security Master + Identifier
C Historical Status
D Corporate Actions + Adjustment
E Liquidity
F Index
G Industry
H Research Ready Gate
```

当前基线以真实 DB 为准，不得使用旧文档数字覆盖真实状态。

---

# 10. STEP 12 数据域验收标准

每一个数据域必须至少记录：

```text
status
row_count
security_count
start_date
end_date
coverage
missing_count
duplicate_count
invalid_count
identity_check
PIT_check
survivorship_check
source
retrieved_at
last_verified_at
```

不能只记录：

```text
xxx 万行
```

因为：

> 行数 ≠ 数据质量。

---

# 11. STEP 12.5 — Historical State Reconstruction

这是数据层和 Research Engine 之间的正式桥梁。

目标：

将：

```text
Raw Data
```

转换为：

```text
Historical Market State
```

对于任意：

```text
security
+
date
```

系统必须能够回答：

```text
当时是什么证券？
当时是否上市？
当时是否退市？
当时属于什么行业？
当时是否可交易？
当时流动性如何？
当时价格是多少？
当时有哪些公司行为已经生效？
当时市场状态是什么？
当时哪些信息已经可知？
```

必须支持：

```text
asOf(T)
```

查询。

---

# 12. STEP 12.6 — Research Dataset Certification

这是整个项目最重要的 Data Gate。

Research Dataset 是未来：

```text
Signal
Backtest
Optimization
Evaluation
WFA
OOS
```

的标准输入。

不得让策略直接依赖多个原始数据表进行随意拼接。

目标架构：

```text
Raw Provider Data
        ↓
Normalization
        ↓
Canonical Data
        ↓
Historical State Reconstruction
        ↓
Research Dataset
        ↓
Research Engine
```

Research Dataset 必须具备：

```text
dataset_version
data_snapshot
universe_definition
PIT policy
survivorship policy
corporate action policy
adjustment policy
industry policy
liquidity policy
```

---

# 13. Research Readiness Certification

`RESEARCH_READY` 不能只依赖表存在。

必须同时满足：

```text
A OHLCV                 PASS
B Security Master       PASS
C Status History        PASS
D Corporate Actions     PASS
E Liquidity             PASS
F Index                 PASS
G Industry              PASS

Identity Validation     PASS
PIT Validation          PASS
Survivorship Validation PASS
Coverage Validation     PASS
Duplicate Validation    PASS
Gap Validation          PASS
Cross-domain Validation PASS
Adjustment Validation   PASS
Research Dataset        PASS
```

只要其中任何一项为：

```text
FAIL
```

则：

```text
RESEARCH_READY = FALSE
```

只要关键项为：

```text
PENDING
```

则不能宣布正式研究准备完成。

---

# 14. STEP 13 — Research Engine

目标：

建立统一 Research Framework。

必须避免策略代码直接操作数据库细节。

推荐：

```text
Research Dataset
      ↓
Feature
      ↓
Signal
      ↓
Candidate
      ↓
Evaluation
```

Research Engine 必须支持：

```text
dataset version
strategy version
parameter set
date range
universe
market regime
experiment id
```

---

# 15. STEP 14 — Backtest Engine

目标：

建立可信交易模拟。

必须考虑：

```text
initial capital
position sizing
cash
commission
stamp duty
slippage
market impact
liquidity
lot size
price limit
suspension
buy restrictions
sell restrictions
execution timing
T+1
order constraints
```

禁止只实现：

```text
signal → next close
```

就宣布回测可信。

---

# 16. STEP 15 — Strategy Definition

策略必须结构化。

统一：

```text
Strategy
 ├── strategyId
 ├── version
 ├── name
 ├── description
 ├── universe
 ├── entry rules
 ├── exit rules
 ├── position sizing
 ├── risk rules
 ├── parameters
 ├── dataset version
 └── execution assumptions
```

策略必须可以：

```text
保存
加载
复制
比较
回测
优化
版本化
```

---

# 17. Strategy Versioning 最小要求

从 STEP 15 开始就必须具备最小版本能力。

例如：

```text
Strategy V1.0
Strategy V1.1
Strategy V2.0
```

每个版本必须能够追溯：

```text
strategy
parameters
dataset
universe
backtest config
cost model
execution model
code version
created_at
```

STEP 21 再扩展为完整 Strategy Lifecycle。

---

## 17.1 STRATEGY-003 对版本能力的加固（2026-09-12 16:20，已完成）

STEP 15 的「最小版本能力」在 **STRATEGY-003** 中补齐为可被 Research / Parameter Search / Backtest 消费的完整 Domain Model：

| 能力 | STRATEGY-002（原状） | STRATEGY-003（现状） |
|---|---|---|
| 版本来源 | 只能从 `latest` 派生（`createVersion`） | **可从任意历史版本 clone**（`cloneVersion(strategyId, fromVersion, options)`） |
| 演进链 | 无 | `strategy_versions.parentVersionId` → 源版本行（软引用，无 FK） |
| 状态 | 仅 `strategies.status` | `strategy_versions.status` 落 C-21.1 **八态**，默认 `Draft`；**status 是唯一允许 UPDATE 的列** |
| 当前版本 | `strategies.latestVersion`（字符串） | `strategies.currentVersionId`（**权威指针**），`latestVersion` 降级为兼容冗余列，二者由 `refreshEntityPointer()` 保证不漂移 |
| 定义模型 | `StrategyDocument`（声明式规则平铺） | `StrategyDocument.definition`（Canonical `StrategyDefinition`：entry/exit/position/risk/execution/parameters/datasets），v1 字段为**单向派生视图** |
| 指纹 | 文档级 `fingerprint` | **两层**：文档级（落 `fingerprint` 列）+ 定义级（`computeStrategyDefinitionFingerprint`，判「是否同一套规则」） |
| 幂等 | `inserted` / `idempotent-skip` / `conflict` | 同上，且 clone 三态一致（**存在但内容不同必 conflict，绝不覆盖**） |
| 可查询性 | 需解析 JSON | 5 张**单向派生**投影表（parameters / entry / exit / execution / datasets），两级独立验证零漂移 |
| Look-Ahead | 无静态校验 | 8 条规则（L1–L8），**白名单而非黑名单**；时间语义不明默认拒绝 |

🔴 **Source of Truth 铁律（不可动摇）**：`strategy_versions.strategyDocumentJson` 是唯一完整 `StrategyDefinition`；
5 张投影表**只能**由它派生，**禁止**反向拼装。读取路径（`getVersion` / `getLatestVersion` / `getVersionBundle`）
一律经 `assertStoredVersionConsistency()` 断言「三方指纹 + 双份定义」一致，不一致**响亮失败、不修复、不择一覆盖**。

详见 `docs/strategy/STRATEGY-003-report.md`。

---

# 18. STEP 16 — Strategy Evaluation

策略评价必须避免单一指标。

至少覆盖：

```text
收益
风险
回撤
稳定性
交易质量
样本外表现
```

核心指标包括：

```text
CAGR
Total Return
Max Drawdown
Sharpe
Sortino
Calmar
Win Rate
Profit Factor
Expectancy
Turnover
Average Holding Period
Trade Count
Recovery Factor
```

同时考虑：

```text
tail risk
drawdown duration
monthly consistency
yearly consistency
regime performance
```

---

# 19. STEP 17 — Parameter Optimization

优化目标不是：

> 找到历史收益最高参数。

而是：

> 找到表现良好且稳定的参数区域。

必须区分：

```text
Optimization
```

和：

```text
Final Strategy
```

优化结果应该产生：

```text
Candidate Strategies
```

而不是直接产生：

```text
Production Strategy
```

未来支持：

```text
Grid Search
Random Search
Rolling Optimization
```

并记录完整实验信息。

---

# 20. STEP 18 — Robustness Testing

必须逐步支持：

```text
Cost Stress
Slippage Stress
Parameter Perturbation
Parameter Stability
Monte Carlo
Bootstrap
Trade Order Randomization
Execution Perturbation
```

目标：

判断策略是否依赖某一个：

```text
参数
交易
成本假设
市场阶段
```

---

# 21. STEP 19 — Walk-Forward / OOS

必须严格区分：

```text
In-Sample
Out-of-Sample
```

推荐：

```text
Train
    ↓
Optimize
    ↓
Freeze
    ↓
Test
    ↓
Move Window
```

禁止：

```text
OOS 数据参与参数优化
```

必须保存：

```text
window id
train period
test period
parameters
result
metrics
```

---

# 22. STEP 20 — Overfitting Detection

至少逐步支持：

```text
PBO
Parameter Sensitivity
Factor Ablation
Perturbation Test
OOS Degradation
```

目标：

识别：

```text
Backtest 很好
但真实泛化能力很差
```

的情况。

---

# 23. STEP 21 — Strategy Lifecycle Management

完整管理：

```text
Draft
↓
Research
↓
Candidate
↓
Validated
↓
Paper
↓
Approved
↓
Production
↓
Retired
```

每次状态变化必须有：

```text
timestamp
reason
experiment
evidence
```

禁止策略无记录地修改。

---

# 24. STEP 22 — Market Regime Analysis

建立：

```text
Market Regime
```

体系。

至少考虑：

```text
Trend
Volatility
Liquidity
Breadth
Market Sentiment
Index State
Limit-up Environment
```

目标：

回答：

> 策略到底在哪些市场环境有效？

而不是只看总体收益。

---

# 25. STEP 23 — Paper Trading

必须使用和真实交易尽可能一致的：

```text
Signal
Position
Execution
Risk
Capital
Cost
```

模拟交易必须记录：

```text
paper run
strategy version
dataset
signal
order
execution
position
PnL
```

---

# 26. STEP 24 — Trading Review / Discipline

这是最终实现：

> 帮助用户改善交易纪律

的核心模块。

必须逐步支持：

```text
Trade Journal
Signal
Planned Trade
Actual Trade
Deviation
Reason
Emotion
Rule Violation
Post-trade Review
```

核心不是记录交易，而是识别：

```text
为什么违反规则？
哪些错误重复出现？
哪些策略执行最差？
哪些市场环境最容易犯错？
```

---

# 27. STEP 25 — Production Quant Platform

最终系统必须形成：

```text
Data
Research
Strategy
Backtest
Evaluation
Optimization
Robustness
OOS
Overfitting
Regime
Paper Trading
Review
Discipline
```

完整闭环。

最终用户可以：

```text
定义一个主观交易模式
        ↓
转换成程序化规则
        ↓
选择历史区间
        ↓
回测
        ↓
评价
        ↓
优化
        ↓
稳健性
        ↓
OOS
        ↓
过拟合检测
        ↓
模拟交易
        ↓
交易复盘
```

---

# 28. Experiment Registry

从 STEP 13 开始必须逐步建立实验追踪体系。

每一次研究实验必须具有：

```text
experiment_id
strategy_id
strategy_version
dataset_version
universe_version
parameter_set
date_range
cost_model
slippage_model
execution_model
regime
metrics
result
code_version
created_at
```

目标：

任何历史结果都可以回答：

> 这个结果到底是怎么产生的？

---

# 29. Provider Architecture

不要把具体数据 Provider 设计成系统铁律。

统一：

```text
Provider Layer
      ↓
Normalization
      ↓
Canonical Data
      ↓
Research Dataset
```

允许未来接入：

```text
Tushare
BaoStock
AkShare
其他 Provider
```

但 Provider 不得直接污染 Research Engine。

必须记录：

```text
provider
retrieved_at
source_version
```

---

# 30. 并行开发规则

允许并行的前提：

> 不共享同一个存在竞争条件的资源。

例如 BaoStock 单账号单活跃 Session：

```text
禁止：
C + E + G
```

同时访问。

必须：

```text
G
 ↓
C + E
 ↓
D
```

串行。

如果未来发现新的资源竞争：

必须立即更新本 Master Control Spec。

---

# 31. WorkBuddy 自主推进规则

以后不需要每完成一个 Work 都等待用户手工指定下一步。

你必须：

### 第一优先级

检查：

```text
当前真实 DB 状态
```

### 第二优先级

检查：

```text
当前 Master Control Spec
```

### 第三优先级

判断：

```text
Dependency
Gate
Blocking
```

### 第四优先级

自动选择：

> 当前所有满足 Entry Criteria 且不存在资源冲突的任务。

### 第五优先级

执行。

### 第六优先级

验证。

### 第七优先级

更新本文件。

---

# 32. Entry Criteria / Exit Criteria

以后每个 STEP 必须具有：

```text
Entry Criteria
Exit Criteria
```

例如：

```text
STEP 13 Entry:

RESEARCH_READY = TRUE
Research Dataset = VALIDATED

STEP 13 Exit:

Research Engine
CODE_READY
DATA_READY
VALIDATED
```

不能仅仅：

```text
代码写完
```

就宣布完成。

---

# 33. Blocked Rule

如果任务依赖尚未满足：

```text
BLOCKED
```

必须明确：

```text
blocked_by
reason
required condition
next trigger
```

例如：

```text
STEP 13
BLOCKED

blocked_by:
STEP 12.6

reason:
Research Dataset not certified

trigger:
RESEARCH_READY = TRUE
```

---

# 34. Definition of Done

一个 STEP 只有满足：

```text
Implementation
+
Tests
+
Real Data
+
Validation
+
Evidence
+
Documentation
+
Exit Criteria
```

才能：

```text
DONE
```

---

# 35. Route Map Maintenance Rule

本文件必须持续维护。

每完成一个任务：

必须更新：

```text
数据快照
任务状态
依赖状态
Gate 状态
阻塞原因
下一任务
更新记录
```

不得删除历史更新记录。

`§ 更新记录` 必须：

> append-only。

---

# 36. 真实状态优先规则

每次更新本文件之前：

禁止直接相信旧版本中的：

```text
row count
status
coverage
task completion
```

必须优先检查真实：

```text
DB
code
test
runtime
logs
```

旧文档只能作为参考。

---

# 37. 最终状态模型

整个项目最终应该达到：

```text
DATA_TRUSTWORTHY
        ↓
RESEARCH_READY
        ↓
STRATEGY_RESEARCH_READY
        ↓
BACKTEST_VALIDATED
        ↓
ROBUSTNESS_VALIDATED
        ↓
OOS_VALIDATED
        ↓
OVERFITTING_CHECKED
        ↓
PAPER_TRADING_VALIDATED
        ↓
PRODUCTION_READY
```

禁止跳跃。

---

# 38. 当前阶段执行要求

当前真实阶段：

```text
STEP 12
```

优先级：

```text
1. A OHLCV 收尾
2. G Industry 收尾
3. C Historical Status
4. E Liquidity
5. D Corporate Actions
6. H Research Readiness
7. STEP 12.5 Historical State Reconstruction
8. STEP 12.6 Research Dataset Certification
9. STEP 13
```

严格遵守 BaoStock 单 Session 串行限制。

---

# 39. 当前阶段禁止事项

在：

```text
RESEARCH_READY = FALSE
```

之前：

禁止：

```text
正式策略结论
大规模参数优化
宣布策略有效
宣布策略具备实盘价值
```

可以：

```text
开发代码
完善框架
写测试
做小规模技术验证
建立 Research Engine
完善 Backtest
```

但必须明确：

```text
TECHNICAL VALIDATION
```

和：

```text
RESEARCH CONCLUSION
```

不是一回事。

---

# 40. Master Control 输出格式

以后每次完成重要任务，必须输出：

```text
### 1. Task
任务名称

### 2. Status
DESIGN / CODE_READY / DATA_READY / VALIDATED / RESEARCH_READY / PRODUCTION_READY / BLOCKED

### 3. Evidence
真实 DB / Runtime / Test / Code

### 4. Changes
修改文件及核心变化

### 5. Data Snapshot
真实数据状态

### 6. Validation
测试与验证结果

### 7. Gate
PASS / PENDING / FAIL

### 8. Dependencies
前置与后续依赖

### 9. Risks
剩余风险

### 10. Next Action
下一步最优任务

### 11. Master Spec Update
必须同步更新本文件
```

---

# 41. 最终原则

不要以：

```text
Work 完成数量
代码行数
功能数量
UI 页面数量
```

衡量项目成功。

真正成功标准：

> **系统能够使用真实历史市场状态，在没有 Look-ahead Bias、没有 Survivorship Bias、具有可复现数据快照和明确执行假设的前提下，对用户主观交易规则进行可信的历史研究，并通过 OOS、稳健性和过拟合检测，最终进入模拟交易和交易纪律闭环。**

---

# 42. 本次任务要求

你现在的任务不是立即大规模修改业务代码。

首先：

1. 阅读当前项目真实代码、DB、Schema、Migration、Tests、现有 STEP 12 Work 状态。
2. 对照本 Master Control Spec。
3. 识别当前项目与本规范之间的差异。
4. 不得破坏当前正在运行的 STEP 12 数据回填任务。
5. 不得为了适配本规范而重写已经正确工作的业务代码。
6. 将当前真实状态映射到本规范。
7. 将本规范落地为项目中的唯一 Master Control 文档。
8. 如果项目已有类似路线图，保留历史信息，但以本规范为新版本。
9. 建立明确的 Entry Criteria / Exit Criteria / Gate / Dependency。
10. 建立后续可以让 WorkBuddy 自主推进的任务状态模型。
11. 对当前 STEP 12 不满足的项目项只标记为：  
    `PENDING / BLOCKED`  
    不得虚假标绿。
12. 不得因为代码已经存在就自动认为对应 STEP 已经 VALIDATED。
13. 不得因为测试通过就自动认为 Research Ready。
14. 所有结论必须基于真实项目证据。

---

# 43. 最重要的执行原则

从现在开始：

> **真实项目状态决定路线图，而不是路线图决定真实项目状态。**

Master Control Spec 是：

```text
规划依据
+
状态机
+
验收标准
+
依赖管理
+
Research Gate
+
WorkBuddy 自主推进协议
```

但它永远不能凌驾于：

```text
真实 DB
真实代码
真实运行结果
真实测试结果
```

之上。

最终目标不是“完成路线图”。

最终目标是：

> **构建一个可信、可复现、能够真正帮助用户研究和改进自己交易模式的个人量化研究平台。**
>
>

---

# 44. 项目真实状态映射（数据快照）

> 本节为「状态机」落地区，由**真实 DB 状态**驱动（§36），随任务推进**覆盖式更新**（非 append-only）。

> 🔴 **历史实查条目已归档（2026-09-15）**：本节原有 **48 条**「上轮实查 / 最后实查 / 此前实查 / 最新实查」巨型条目（合计 **230125 B**），违反本节自己的规则「**只有一条 `上轮实查`**」，已**全部移入 `ROADMAP-CHANGELOG.md`**（原样搬运，非删除）。**本节现只保留最近 1 条**。
> 检索历史：`grep "上轮实查" ROADMAP-CHANGELOG.md`。逐字节原文备份：`.cache/ROADMAP.md.before-cleanup-20260915`。

> 上轮实查：**2026-09-21 · EXP-001（首板后回踩第一性研究 · 独立实验首次真实投产）（用户规格）**（编号 `9ci`；`tsc --noEmit` **0 error**；`pnpm run build` **exit=0**（vite 17.02s → `dist/public` index-BiMm_3Dc.js 2,819.61 kB / index-BYxQvOek.css 236.88 kB + esbuild `dist/index.js` 2.9 MB）；`test:changed` **2 文件 / 71 例全绿** ⇒ 零新增失败文件；定向 `vitest run tests/server/researchExperiments` = **11 文件 / 203 例全绿**；`legacyFreeProductionChain` Gate **7 例 PASS**；`checkEolDrift.mjs` 行尾漂移 **0 / 0**）。**① 定位**：这是 `9ch`（独立研究实验持久化基础设施）落地后的**第一次真实投产** —— 不改框架，只用一个真实研究问题把「声明式实验定义 → 真库取数 → 结果落 TiDB + 产物落 MinIO → 关页面重开仍可回看」整条链走通。**② 交付**：新实验目录 `research-experiments/first-board-pullback/fundamental-study/`（`result.ts` 结果组装 / `experiment.ts` 取数与逐事件评估 / `page.tsx` 前端页 / `README.md` 口径说明）+ 两处注册同步（`research-experiments/manifest.ts` + `client/src/researchExperiments/pages.ts`，键 = `descriptor.pageKey`）；**零 migration / 零新依赖 / 零 tRPC 路由改动 / 零 DB schema 改动**，未触碰 Research Core / Strategy Core。**③ 真实 Run（真库 + 真 Dataset + 真 MinIO）**：`RUN-20260920-2A91D7C2`（`COMPLETED`，`durationMs=135389`）跑在 `first_limit_pullback` v2（`datasetVersionId=390002`，声明事件 23978）；产物 **10 个对象**（`result.json` 71370 B + `manifest.json` + 5 CSV + 2 SVG + `logs/run.log`），逐个 `exists()` 实测 + **绕开服务层**直接列举 MinIO 前缀复核；重新查询 Run / Manifest / Result / CSV / SVG 全部读回一致。**④ 研究数字（全部真机实测）**：候选 20000 / 入池 19877 / 剔除 123（全部 `INVALID_OBSERVATION_OHLC`；实测归因为「**物理行存在但 OHLC 为 NULL**」449 行，不是缺行）；截至 T+5 曾回踩 **85.53%**（17001）、**路径中始终未跌破首板日开盘价 66.77%**（13272）、曾跌破 **33.23%**（6605）；逐日回踩率 T+1…T+5 = 68.93 / 67.17 / 63.88 / 63.92 / 63.50%；截至不破位率 = 90.91 / 83.51 / 77.12 / 71.42 / 66.77%；6 个回撤桶（`DD_500BP` 23.52% 最大）；**不破组 vs 破位组中位收盘收益差 T+5/T+10/T+20 = +0.1082 / +0.1009 / +0.0951**（三视界方向一致、量级稳定）；观察 **17 条**（DESCRIPTIVE / COMPARATIVE / POTENTIAL_SIGNAL / LIMITATION 四类齐备，越界句 0）+ 假设 H1/H2/H3；**不产出任何 Strategy / Candidate / 参数结论**。**⑤ 性能**：`actualQueryCount = 21`（rd=0 一次 + 20 个观察日各一次）vs `naiveQueryCount = 420000`，即 **1 : 20000**；单测用读取层调用日志把「禁 N×M 逐事件逐日查询」钉死。**⑥ 五条真缺陷（全部已修 + 已加测试钉死）**：⑴ 把 `values.tradeDate` 当行身份字段读 —— `values` **只含声明列**、`tradeDate` 是行身份字段 ⇒ 恒 `undefined` ⇒ **全部样本被判「行身份缺失」而误剔**，而结果看起来只像「样本量为 0」；⑵ 观察句里「曾跌破的占比」误用**当日**破位率 ⇒ 同一句出现「未跌破 66.77% / 曾跌破 26.23%」，**两个数加起来不到 100%**，是会被读成事实的假信息；⑶ 🔴 **样本账缺口 3978 未登记** —— 数据集声明 23978、本轮候选 20000，差额**既不在候选、也不在剔除清单**，而平台守恒式 `eligible + excluded = candidate` 对「压根没进候选」的事件**恒真、毫无保护** ⇒ 新增 `customPayload.candidates.unscannedEventCount`，并在**页面首屏告警条 / `sampleSummary.notes` / 一条 `LIMITATION` 观察**四处出数；缺口为 `null` 表示总数不可知（**不是 0**）也已单测钉死；⑷ 规范 `docs/research/EXPERIMENT-CODE-SPEC.md` **§P.3 代码示例与 §P.5 映射表自相矛盾**（示例写 `name: "tables/x.csv"`，映射表却显示 `name` 不含角色段）⇒ 真机产物落成 `tables/tables/x.csv`，修正 4 处（`result.ts` / `experiment.ts` / 规范 / `research-experiments/template/README.md`）+ E2E 新增「角色段不重复」回归闸；⑸ 🔴 **修了 ⑷ 却漏掉作者面模板** `research-experiments/template/experiment.ts`（那次演示 `artifact()` 仍写 `name: "tables/group-counts.csv"`）⇒ **照模板复制的新实验会集体踩 ⑷**，而发现时 202 例单测全绿也没抓到（没有任何测试真机跑过模板）⇒ 修正演示调用 + **新增全仓静态扫描回归闸**（扫 `research-experiments/**` 代码行、跳过注释行，禁 `name: "<角色段>/…"`），并**实测可红**（改回错误写法立刻报 `template/experiment.ts:144`）。**⑦ 测试**：EXP-001 单测 **62 例全绿**（规格 §28 十六个面 + E1–E6 六形态夹具）；真实 E2E **20 步全 PASS**（新增 0b 无在途 Run 前置闸 / 5b 账目缺口 / 9b 角色段不重复）。报告 = `docs/research/EXP-001-final.md`（21 节）；E2E = `docs/evidence/_e2e_9ci_exp001.mts`；数字探针 = `docs/evidence/_probe_9ci_exp001_numbers.mts`；**前端可达性探针 = `docs/evidence/_probe_9ci_exp001_frontend.mjs`**（无头 Edge + CDP 量 DOM，走**完整真实用户路径**：列表页 → 点「打开」→ 详情页 → **真点一次「运行」** → 自定义结果页 → 点「打开这一条 Run」→ RunDetail）= **42 PASS / 0 FAIL**（新 Run `RUN-20260920-902A6515`；首屏「样本账有缺口」告警条实测渲染且可见，取最内层命中盒 textLen=151；越界措辞句子级扫描 462 句 / 2621 句均为 0）。🔴 **第一次跑是 15 FAIL，根因是探针自身假设错（不是产品缺陷）**：⑴ 实验**详情页不会自动渲染历史 Run** —— 结果区条件是 `outcome !== null`，而 `outcome` 只来自**本次会话的 `runMutation`** ⇒ 验证自定义结果页**必须真点运行**；历史 Run 走 `/…/runs/:runId`，而 RunDetail **刻意不重建 execution** ⇒ 走通用渲染器、不挂自定义页面（第一版探针因此得 15 条假 FAIL）；⑵ 侧栏导航项**不是 `<a href>`**（`AppShell.tsx` 用 `SidebarMenuButton` + `onClick`）⇒ 旧判据 `a[href="/research-experiments"]` 永远查不到，正确锚点 = `[data-sidebar="menu-button"]` + `data-active`；⑶ 观察类别在 DOM 里渲染为**中文标签**（描述性事实 / 分组比较 / 值得进一步验证 / 局限），枚举码 `DESCRIPTIVE / …` **从不进 DOM**；⑷ 「免责声明不得删」**适用范围已收窄为研究侧强制件**（首页梯队区块 / 结论正文），**独立实验页从未要求挂免责声明**，旧判据恒假。四条均已登记在报告 §19.4 与 `docs/evidence/README.md` 的 `9ci` 节。**未做（如实登记）**：行业 / 市值 / 板块中性化（`boardType` 在 v1/v2 全为 `main`，做了就是伪信息）、T+20 之后的后续表现（post 物理视界 rd ≤ 20）、显著性 / 稳健性 / OOS、入场日视角 `next20`（结构不可用）。**停在 EXP-001 COMPLETE，未自动开始下一步研究或策略工作。**

## 44.1 真实 DB 数据快照（实查，非历史报告）

| 域 | 表 | 行数 | 覆盖判定 |
|---|---|---|---|
| A OHLCV | stock_daily_prices | **8,891,118** | 2019-01-02 → 2026-09-04，**1863/1863 交易日 FULL，缺口 0、重复 0**，5796 股 |
| B Security Master | research_securities | **5,552** | 含退市股，FULL |
| B Identifier History | research_security_identifier_history | **5,552** | 与 securities 一一对应，FULL |
| C Status History | research_security_status_history | **10,373** | 事件态覆盖 **1,830 只**（SUSPENDED 1,830 + ST 734），gate #6/#12 PASS（事件态口径，见下备注） |
| D Corporate Actions | corporate_actions | **31,641** | 事件态覆盖 **4,824 股**（主板 2,932 + 创业板 1,338 + 科创板 553 + 1），gate #10 PASS |
| D Adjustment Factors | adjustment_factors | **31,337** | **5,025 股**全市场（主板 3,039 + 创业板/科创板 1,986），gate #11 PASS |
| E Liquidity | liquidity_daily | — | **5,131 股** ≥5000，gate #9 PASS |
| F Index Master | index_master | **8** | 4 核心指数 |
| F Index Daily | index_daily | **7,452** | 4 指数 2019-2026，FULL |
| G Industry | industry_assignments | **5,212** | 完成（5212/5552，340 无行业为真实退市/ST；83 行业），PENDING identity/PIT |
| 辅助 | stock_suspension_windows | **155** | 停牌推断源 |

> **Dataset Registry + 独立物理表（STEP DATASET-001 落地 → DATABASE-DESIGN-007 五表分层，2026-09-10 20:15 覆盖式更新）**：Registry 3 表 + 物理表 **5 张**——`dataset_definition`（1 行，code=`first_limit_pullback`，显式存 event/prefix/post/path/outcome 表名）、`dataset_version`（3 行：smoke=151 事件 / v1=516 事件 1 个月 / v2=10,240 事件 2024 全年）、`dataset_build_job`（构建作业 checkpoint/resume）、以及 `ds_first_limit_pullback_{event,prefix,post,path,outcome}`。
>
> | 物理表 | 层 | 列数 | 全库行数（3 版本合计） | 版本内行数（smoke / v1 / v2） |
> |---|---|---|---|---|
> | `ds_first_limit_pullback_event` | 身份 | 18 | **10,907** | 151 / 516 / 10,240 |
> | `ds_first_limit_pullback_prefix` 🆕 | L-事实 原始 rd ≤ 0 | 13 | **10,907** | 151 / 516 / 10,240 |
> | `ds_first_limit_pullback_post` 🆕 | L-事实 原始 rd ≥ 1 | 13 | **202,629** | 523 / 5,938 / 196,168 |
> | `ds_first_limit_pullback_path` | L-衍生 rd ≥ 1 | 15 | **202,629** | 523 / 5,938 / 196,168 |
> | `ds_first_limit_pullback_outcome` | L-聚合 | 10 | **32,721** | 453 / 1,548 / 30,720 |
>
> `dataset_version.totalRows` 口径改为**五表行数之和**（= `DatasetVersionCounts.rowCount`）：smoke **1,801** / v1 **14,456** / v2 **443,536**（旧口径 event 行不计入，故 v2 由 237,128 → 443,536，差异全部来自 prefix/post 拆分与 t 日行归位，**无新增数据**）。

> **Strategy Domain Model（STRATEGY-003 落地，2026-09-12 16:20 实查）**：7 张表全部存在；`strategies` / `strategy_versions` 与 5 张投影表**当前均为 0 行**（验证脚本以唯一 `strategyId` 写入后已逆序清理并复核回到基线 0）。
>
> | 表 | 角色 | 行数（实查） | 关键约束（information_schema 实查） |
> |---|---|---|---|
> | `strategies` | 策略身份 + **权威当前版本指针** `currentVersionId` | **0** | `idx_strategies_current_version` |
> | `strategy_versions` | 不可变版本快照 + 演进链 `parentVersionId` + `status`（C-21.1 八态） | **0** | `uq_strategy_versions_id_version`、`idx_strategy_versions_parent`、`idx_strategy_versions_status` |
> | `strategy_parameters` 🆕 | ParameterDefinition 投影（含 `parameterRole`） | **0** | `uq_strategy_parameters_version_code` |
> | `strategy_entry_rules` 🆕 | Entry.conditions 投影（event/window/trigger 冗余到每行） | **0** | `uq_strategy_entry_rules_version_rule` |
> | `strategy_exit_rules` 🆕 | Exit.rules 投影 | **0** | `uq_strategy_exit_rules_version_rule` |
> | `strategy_execution_rules` 🆕 | ExecutionDefinition 1:1 投影（signalTiming / executionTiming **分离**） | **0** | `uq_strategy_execution_rules_version` |
> | `strategy_version_datasets` 🆕 | Dataset 绑定引用（只落引用，不复制数据） | **0** | `uq_strategy_version_datasets_binding` |
>
> Migration = `drizzle/0034_strategy_domain_model.sql`（15 语句，`-- @guard:` 守卫式幂等；apply 两次 = `15 executed → 0 executed / 15 skipped`）。真实库全链验证 `scripts/verifyStrategyDomainModel.mts` = **89 项检查 / 0 失败 / exit 0**。
> v2 仍为基准版本：2024 全年 10,240 首板事件 / 196,168 后置行情 / 196,168 路径 / 30,720 结果。数据质量全 PASS（唯一性 0 重复、版本隔离、交易日历周五→周一、反策略绑定 0 列）。
> 🔴 **本次为「就地迁移」而非重建**：数据零丢失——原 `path` 的 rd=0 行（10,907）移入 `prefix`、rd≥1 行（202,629）复制进 `post` 并保留在 `path`；被摘除的列全部是**重复列**（`returnFromEventClose` ≡ `closeFromEventClose`、`pullbackFromEventClose` ≡ `lowFromEventClose`）、**死列**（`path.turnover` 全 NULL）或**已由 prefix 承载的原始 OHLC**。迁移脚本 `scripts/applyDatasetWindowLayering.mts`（幂等，`--dry-run` / `--check` 只读）。

> **DATASET-003B 备注（2026-09-10 18:30，构建筛选能力补齐 + 🔴涨停漏判修复，`COMPLETE`）**：
> **新增 3 张配置表**（`dataset_build_config` 主表与 `dataset_version` 1:1 UNIQUE + `dataset_build_config_event` / `dataset_build_config_board` 两张多值子表，
> `drizzle/0029_dataset_build_config.sql` + `scripts/applyDatasetBuildConfig.mjs` 已真实建表）；**`ds_*` 三物理表与 Registry 三实体结构不变**。
> 筛选口径两层（Universe：板块/排除ST；Signal：事件维度「相对日×事件类型」OR 语义 + t 前/后窗口）+ 执行参数（视界/批大小）同表固化；
> 建版本入参收敛为单一 `filter`；未完成/非法筛选 → `INVALID_BUILD_FILTER`（构建门禁，不留半成品版本）。
>
> 🔴 **重大修复（影响既有数据）**：`detection.isLimitUpClose` 原用**未四舍五入**的 `preClose×(1+ratio)` 作涨停阈值，而交易所涨停价四舍五入到分；
> 真实数据实测（`docs/evidence/_limitprecision_probe.mjs`，2025-01-01..2026-09-04 / 299,946 行）**收盘价恰为涨停价的封板样本 4,325 个中漏判 1,645 个 = 38.03%**。
> 新增 `boardRules.exchangeLimitUpPrice`（四舍五入到分）并统一用于「涨停判定」与「事件行 limitUpPrice 事实列」。
> **因此 smoke/v1/v2 的既有样本数偏低，须用修复后口径重建；重建前不得基于旧数据产出策略结论。**
>
> **数据快照**：本次验证（`scripts/verifyDataset003b.mts`，真实 TiDB，生产同源装配）建 5 个临时版本后全部清除，
> `dataset_definition` 仍 1 行、`dataset_version` 仍 3 行（smoke/v1/v2）、`dataset_build_config` 回落到 0 行、三张 `ds_*` 表行数未变。
> **验证终态：10 阶段 47 项检查全部通过（47/47，失败 0）**，覆盖：
> ① 构建门禁（events 为空 / postWindowDays 越界 / **正锚点未来泄漏** / 未知板块 四类非法入参全拒，且拒绝后不留半成品版本 `before=3 after=3`）；
> ② 基准版本真实构建 READY（events=740 / rows=17020）+ 配置回读逐字段一致（主表标量 + events/horizons 多值子表）+ 版本详情视图带 `buildConfig` 可渲染；
> ③ **板块筛选真实生效**（仅主板 682 < 全板块 740，且 682 严格为子集）；
> ④ **排除 ST 真实生效**（对照组基准版本含 ST 样本 71 个；排除版 669 事件逐条按**生产 PIT 口径**回查 **违规 0**）；
> ⑤ **T-1 日锚点真实生效**（790 事件，抽查 60 笔「前一交易日确实涨停」**违规 0**；与 T 日首板集 740 不同）；
> ⑥ **前置窗口真实物化**（`preWindowDays=5`：负相对日 path 行 3700，`close` 非空 3605 行=真实 OHLC 非占位；`distinct=[-5..-1]` 且夹取在日历左边界内，诚实不臆造）
>   —— ⚠️ **此项描述的是五表分层前的 3 表结构**（负相对日曾写入 `path`）；DATABASE-DESIGN-007 后负相对日与 rd=0 行一律归 `prefix`，`path` 只保留 rd ≥ 1。脚本已同步改写（`验证①prefix 含负相对日` + `path 无 rd ≤ 0 行`）；
> ⑦ 删除级联清配置（`purgedRows=8880 jobsDeleted=1 configsDeleted=1`，删后配置回读 null、物理行清零）+ 临时数据集级联 DROP 3 表；
> ⑧ 零残留（临时版本/配置行/定义 全部 0）。
> 静态：tsc exit 0、目标套件 **17 文件 / 252 tests 全过**、`npm run build` PASS。
>
> **并行发现（未修复，已上报）**：`runner.ts` 收尾 `completeJob` → `markReady` 为**两次独立写库**，窗口内可观测到 `job=COMPLETED` 而 `version=BUILDING` 且计数为 0；
> 5 次真实构建实测该窗口 lag = `[0, 0, 0, 840, 833]` ms（min=0 / max=840 / avg=335），**非零窗口真实出现**；
> 若进程在两次之间崩溃，版本将永久停留 BUILDING（`COMPLETED` 不可 retry）。DATASET-003A 已在验证脚本侧规避，**执行器侧仍未修复**（建议合并为单事务）。
>
> **并行排查（结论：非重复写入）**：针对「path/outcome 数据一直重复」的反馈，真实 DB 分三层取证（`docs/evidence/_dupcheck_probe.mjs`）——
> L1 表内重复 **0**（三表按唯一键分组 `HAVING COUNT(*)>1` 均 0 组，唯一索引实实在在）；L2 跨版本同源属**版本隔离的正确行为**（每版本各存一份，最多 6 个版本）；
> L3 `path_rows = 事件数 × 相对日数` 严格成立。观感重复来自「临时验证版本与 v1/v2 窗口重叠」+「v1 窗口是 v2 子集」。

> **DATASET-003A 备注（2026-09-10 16:40，多数据集 + 删除能力，`COMPLETE`）**：**无数据快照变更、无 migration / schema.ts 改动**。新增能力为**架构层**：`DatasetPluginRegistry`（每 datasetCode 自带表结构 DDL + IO + 构建器，核心零硬编码）与 `DatasetPhysicalStore`（建表 / 清版本数据 / DROP 表 + 表名白名单）；Registry 三实体与 `ds_*` 三物理表**结构完全不变**。删除语义：删版本 = 删数据 + 删作业 + 删版本记录（**保留表结构**）；删数据集 = 级联 + **DROP 全部物理表** + 删定义。真实 TiDB 验证（`scripts/verifyDataset003a.mts` 44/44）使用**临时数据集** `verify003a_probe` / `verify003a_nobuilder`，验证后已全部删除、零残留；`dataset_definition` 仍为 1 行（`first_limit_pullback`）、`dataset_version` 仍 3 行、三张 ds_* 表行数未变（`purgeVersionRows`/`dropTables` 未触碰既有数据集）。仅 `dataset_definition` / `dataset_version` / `dataset_build_job` 的 AUTO_INCREMENT 序列因临时记录推进（不影响数据快照）。

> **09-09 03:33 备注（C/D/E 收尾 + gate 口径修正）**：D 全量回填收官——corporate_actions 主板（9/8 完成 2,932 股）+ 创业板 1,338 + 科创板 553（9/9 03:01 完成）；adjustment_factors 全市场 5,025 股早已 FULL。E 域补跑后 5,131 股（9/9 命令③，≥5000 达标）。**certify gate 阈值口径修正（§48.3 R1 / P0-4 落地）**：C 域 `research_security_status_history` 与 D 域 `corporate_actions` 均为**事件态表**（仅存发生过停牌/ST、分红/送转的证券），原按全证券数 5,500/5,000 判永不达标 → C 改「事件类型齐备 + 覆盖≥1,500」、D 改「CA ≥ AF − 容差 250」（2026-09-09 实查：AF-only 缺口 201 只样本在 BaoStock query_dividend_data 返回 0 行=确无分红送转事件，正常不产生 CA 行）；LISTING/DELISTING 全量边界由 securities（#4，5,552 只含退市 337）承载。**结果：gate 17/17 全 PASS，`RESEARCH_READY = TRUE`**。G 域两项质量待办（securityId 全 NULL + effectiveFrom 单点）保持 PENDING 不变，属 STEP 12.5 PIT 审计前必修。

> **G 域质量待办详情（2026-09-06 23:41 记录，保持）**：`industry_assignments` 落库 5212 行（5212 股 / 83 申万行业），340 只无行业归属为真实退市/ST/特殊股。① `securityId` 全 5212 行为 NULL（仅 `securityCode` 有值），G 回填未填 canonical identity 列，违反 §6 身份铁律，需用 code→research_securities 桥接一次性回填；② `effectiveFrom` 全部 = `2026-08-31` 单点（BaoStock 只给「当前」行业快照，无历史变更轨迹），历史 asOf(T) 行业查询只能近似（用 retrievedAt 语义），严格 PIT 行业轨迹需另寻历史源（申万历史成分/聚宽）或声明为「当前快照口径」。

> **RESEARCH-001 备注（2026-09-10 22:56，Research 数据库与领域对象，`COMPLETE`）**：
> **新增 10 张 Research 表**（migration `drizzle/0031_research_core.sql`，纯新增 `CREATE TABLE IF NOT EXISTS`，对既有表零改动）：
> `research_experiment`(12 列) / `research_hypothesis`(10) / `research_run`(12) / `research_analysis`(9) / `research_analysis_condition`(10) /
> `research_analysis_metric`(7) / `research_result`(9) / `research_conclusion`(11) / `research_strategy_candidate`(14) / `research_artifact`(9)
> —— **合计 103 列 / 30 索引项（28 idx + 2 unique）+ 10 PK**。
> 实测真实 TiDB：`scripts/applyResearchCore.mjs` → **`PASS — 检查 95 项，失败 0 项`**；二次运行幂等（`38/38` → `10/38` + 幂等跳过 28）；反模式扫描「Research 侧 Dataset 复制表 = **0 张**」；
> **Research 侧 10 表全部为空表（0 行）**，本次不动 `dataset_definition`(1) / `dataset_version`(2) / `strategies` / 任何 `ds_*` 物理表。
>
> ⚠️ **与遗留 `research_experiments` / `research_runs` / `research_datasets`（复数）的区别**：遗留三表属 **STEP 6.x 链路**
> （字符串 `experimentId` 业务键 + `strategyId` 驱动 + 单一 `snapshotJson`，`research_experiments` 0 行 / `research_runs` 2 行 / `research_datasets` 7 行），
> 服务「Strategy → Parameter Search → Backtest」下游；新增 10 张**单数**表是 **Dataset-Registry 原生** Research 领域层，
> 以 `datasetVersionId`（bigint，软引用 `dataset_version.id`）为输入边界，服务「Dataset → Research → Conclusion → Strategy Candidate」上游。
> **两套并存、互不引用、互不读写**；本备注与 `RESEARCH-001-AUDIT.md §4` 为唯一对照消歧依据（两套表名仅差一个 `s`）。
>
> **真实 DB 端到端验证**：`npx tsx scripts/verifyResearchCore.mts` → **`PASS — 检查 45 项，失败 0 项`**（跑 `createDbResearchRepositories()` 本体）。
> 硬证据包括：dataset_version 不存在 → `RESEARCH_DATASET_VERSION_NOT_FOUND`（零 FK 下应用层保证）；裸 SQL 重复插入 `(experimentId, runNo)` **被 DB 唯一约束拒绝**；
> `research_result` 的 `metricCode` / `metricValue` / `sampleCount` **结构化落列可 SQL 直查**（非 JSON 一把梭）；分组行 `dimensionJson` 含 `quantile`；
> 完整链路 DatasetVersion→Experiment→(Hypothesis|Run→Analysis→Result)→Conclusion→Candidate→转正 走通；脚本逆序自清理，**零残留**。
>
> **静态验证**：`npx tsc --noEmit` **exit 0**；新增套件 **5 文件 / 82 tests 全过**；全量 vitest **178 文件 / 2720 tests 通过**，
> 8 个失败文件全为**既有环境依赖失败**（Tushare token / 网络 / DB / 认证快照），与本次**零交集**。
>
> ⚠️ **已知问题**：`drizzle/meta/_journal.json`（idx 仅到 23）与 `*_snapshot.json`（仅到 0015）**自 migration 0024 起停止维护**，
> 故 `npm run db:push`（`drizzle-kit generate && migrate`）**当前不可用**；本次按项目**实际在用**的「手写 SQL + 幂等 apply 脚本」流程落地，
> **未手工补写 journal**（属指令禁止的伪造）。后续如需恢复 `drizzle-kit`，须先重建 baseline。
> 另：新增 `research_experiment` 与遗留 `research_experiments` 仅差一个 `s`，**未来若清理遗留链路应优先重命名遗留表**。

## 44.2 STEP 12 数据域状态（新 7 态模型）

统一采用 §7 状态模型：`DESIGN / CODE_READY / DATA_READY / VALIDATED / RESEARCH_READY / PRODUCTION_READY / BLOCKED`

| 域 | 状态 | 依据（真实证据） |
|---|---|---|
| A OHLCV | **DATA_READY** | 889 万行/5796 股，1863/1863 交易日 FULL，缺口 0、重复 0；覆盖校验 PASS，待 cross-domain VALIDATED |
| B Security Master + Identifier | **DATA_READY** | 5552 全量含退市股（anti-survivorship 达成）；PIT/重叠校验待 VALIDATED |
| C Historical Status | **DATA_READY** | 事件态覆盖 1,830 只（SUSPENDED 1,830 + ST 734）/ 10,373 行；gate #6/#12 PASS（事件态口径，§48.3 R1 修正落地） |
| D Corporate Actions + Adjustment | **DATA_READY** | CA 4,824 股（主板 2,932 + 创业板 1,338 + 科创板 553）+ AF 5,025 股全量；gate #10/#11 PASS（CA 事件态口径，P0-4 修正落地） |
| E Liquidity | **DATA_READY** | 5,131 股补跑达标（≥5,000）；gate #9 PASS |
| F Index | **DATA_READY** | 7452 全量 4 核心指数；PIT 校验待 VALIDATED |
| G Industry | **DATA_READY** | 5212 行/5212 股/83 行业落库；340 无行业为真实退市/ST。identity（securityId 全 NULL）与历史轨迹（effectiveFrom 单点）PENDING，见 §44.1 备注 |
| H Research Ready Gate | **RESEARCH_READY** | gate 17/17 全 PASS（2026-09-09 03:33 判定）`RESEARCH_READY = TRUE` |

## 44.3 后台运行任务（2026-09-07 19:50 实查）

| 任务 | 进程 | 状态 | 说明 |
|---|---|---|---|
| A OHLCV 回填 | 已结束 | ✅ 完成 | 8,891,118 行/5796 股，1863/1863 交易日 FULL |
| G 行业回填 | 已结束 | ✅ 完成 | 5212 行/5212 股/83 行业，340 无行业为真实退市/ST（failed=0） |
| **SQL 版回填（用户新方案，19:38 落地）** | `scripts/backfillStatusLiquidity_sql.ts` | 🆕 **就绪** | **回填脚本的 SQL 输出变体**：所有 DB 写改为流式写本地 .sql 文件（multi-row VALUES + ON DUPLICATE KEY UPDATE 保持幂等），用户拿到 .sql 后自行 `mysql < file.sql` 导入到本地 MySQL。原 `backfillStatusLiquidity.ts`（DB 版）保留不破坏。SQL 版仍读 DB 拉 universe（5552 股标识），避开云端 DB 写入速率限制 / 失败问题。**支持 `--board=main/cyb/kc/bj` 分板**。tsc --noEmit exit 0；头部 SQL 格式已验证合规 |
| C+E DB 版（v2） | 已中断 | ⚠️ 中断 | 18:08 后停止，最终断点 E ~3020 股 / C ~8500 行；环境清理中被 kill |
| D 全量 CA+Adj | 待启动 | ⏳ 排队中 | C+E 完成通知后手动启动（BaoStock 单 Session 串行） |
| D 全量 CA+Adj | 待启动 | ⏳ 排队中 | C+E 完成后手动启动（BaoStock 单 Session 串行） |

### 板块分布（universe 5552，18:50 实查）
- **主板**（SH 60xxxx + SZ 000/001/002/003）：3486 只（user 优先）
- **创业板**（SZ 300/301/302）：1447 只（user 次选）
- **科创板**（SH 688/689）：619 只（user 再次）
- **北交所**（BJ 83/43/82/87）：**0 只**（identifier_history 里没有；研究链路暂不同步）

## 44.4 依赖链与 Gate 状态

```text
STEP 12 (A→H 数据域)
    ↓
STEP 12.5  Historical State Reconstruction   ← BLOCKED（依赖 A~H 全 DATA_READY）
    ↓
STEP 12.6  Research Dataset Certification      ← BLOCKED（依赖 12.5）
    ↓
STEP 13    Research Engine                     ← BLOCKED（依赖 RESEARCH_READY=TRUE）
    ↓
STEP 14~25                                    ← 代码 CODE_READY，数据链 BLOCKED
```

BaoStock 单 Session 串行约束（§30）：`G → C+E → D`（禁止并发访问 BaoStock）

> **C-12.5.1 状态推进（2026-09-06 20:53）**：STEP 12.5 编码任务 `C-12.5.1`
> （`server/historicalState/` asOf(T) 历史状态查询层：types / mappers / reconstruct 纯函数核心
> + db 真实数据加载器 + 单测 28 例全过）已达 **`CODE_READY`**（依据 §39 G2 解耦：编码链不被 G1 阻塞，
> 技术验证先行）。**`VALIDATED`（真数据抽样 PIT 验证）与 `RESEARCH_READY` 仍依赖 A~H 全 `DATA_READY`**
> （当前 C/D/E/G 回填中，见 §44.2/44.3），不得因代码存在而越级标注。

> **C-12.5.2 状态推进（2026-09-06 21:59）**：STEP 12.5 的 VALIDATED 通道 `C-12.5.2`
> （`server/historicalState/audit/` PIT/反泄漏抽样验证：独立朴素 PIT 预言机 oracle + 12 项稳定 ID
> 检查器 checkers + 真实 DB 抽样 + `scripts/runStep125PitAudit.mts` CLI，单测 29 例全过）已达 **`CODE_READY`**。
> 真实 DB smoke（budget=2）23 样本 0 failures、industry PIT guard exercised 3、gate=INCONCLUSIVE（dataReady=false）。
> **`VALIDATED`（抽样报告）依赖 A~H 全 `DATA_READY`**（§0.2 禁止越级）。

> **C-12.6.1 状态推进（2026-09-06 22:45）**：STEP 12.6 编码任务 `C-12.6.1`
> （`server/researchDataset/` Research Dataset 构建器：types / validate / version（确定性
> datasetVersion `rd-1.0.0-1-<sha256>`）/ universe（逐日 PIT 决议，复用 STEP 11 默认拒绝语义）/
> assemble（全代码 code-ownership 防串扰 + 行投影）/ db（真实 DB 批量加载）/ builder（编排 +
> dataSnapshot + gate FAIL/PASS/INCONCLUSIVE）+ CLI `scripts/runStep126BuildDataset.mts`，
> 单测 21 例全过、tsc 干净）已达 **`CODE_READY`**。真实 DB smoke（2026-09-01→04）36s：
> gate=INCONCLUSIVE、两次运行 datasetVersion 一致（确定性）；C 域仅 211 行 ST/SUSPENSION 样本
> → universe 0 成员（全量默认拒绝，诚实反映数据未就绪）、coverageGaps=NO_ROWS_BUILT。
> **`DATA_READY`/`VALIDATED`（§45.2 Exit）依赖 A~H 全 `DATA_READY`**（§0.2 禁止越级）。

> **C-12.6.2 状态推进（2026-09-06 23:10）**：STEP 12.6 编码任务 `C-12.6.2`
> （`server/researchDataset/` policy 策略元数据 9 类 + policyValidate 一致性校验 + versionSnapshot
> 版本快照，builder 产物附 policySet，单测新增 16 → 37 全过、tsc 干净）已达 **`CODE_READY`**。
> policy 映射以 ROADMAP §12/§45.2 为准，adjustment 如实声明 raw 未复权口径。
> **`DATA_READY`/`VALIDATED` 依赖 A~H 全 `DATA_READY`**（§0.2 禁止越级）。

> **C-13.1 状态推进（2026-09-06 23:10）**：STEP 13 编码任务 `C-13.1`
> （`server/research/datasetAccess/` Research Dataset 访问层：handle 绑定 + datasetVersion 一致性 +
> PIT 不变量 + UniverseProvider 适配 + row→bars + date-range 切片 + session 装配，把 ResearchDataset
> 扁平 panel 接进 STEP 10 framework 契约，单测新增 27；research+researchDataset 365 全过、tsc 干净）
> 已达 **`CODE_READY`**（§39 编码先于数据）。regime 属 C-22.1。**`VALIDATED` 依赖数据链就绪后认证**。

> **C-13.2 状态推进（2026-09-06 23:45）**：STEP 13 编码任务 `C-13.2`
> （`server/research/signal13/` Signal/Candidate 引擎：runCandidateEngine 逐 tradeDate 驱动 STEP 10
> pipeline（feature/signal/rank/select/泄漏守卫全转发、不复制逻辑）+ 当日成员缺行/特征 availability
> 全窗口预检 FAIL FAST + evaluateCandidateRun 候选层确定性统计 + 指纹防篡改，单测新增 18；
> research+researchDataset 415 全过、tsc 干净）已达 **`CODE_READY`**。
> Evaluation 界定为候选确定性统计，收益回测属 C-14.1。**`VALIDATED` 依赖数据链就绪后认证**。

> **C-13.3 状态推进（2026-09-06 23:45）**：STEP 13 编码任务 `C-13.3`
> （`server/research/experimentLineage/` §28 实验谱系：15 字段齐备记录 + codeVersion 注入式 +
> 兼容既有 Experiment/Snapshot 映射（缺省显式 missing 不猜）+ 齐备校验器 + 指纹 + bridge，
> 单测新增 32；research+researchDataset 415 全过、tsc 干净）已达 **`CODE_READY`**。
> regime 占位 unassessed（C-22.1 前不误报）；metrics/result 建模为可挂载 outcome。
> **`VALIDATED` 依赖数据链就绪后认证**。
>
> **C-14.1 状态推进（2026-09-07 00:17）**：STEP 14 编码任务 `C-14.1`
> （`server/research/simulator/` 交易模拟核心：plan 候选→Order 适配 + engine 多日编排复用
> STEP 8 原语（import 只读，不重写 T+1/涨跌停/停牌/手数/成本/执行/审计原子能力）+
> TradeSimulationRun 结果绑定（datasetVersion/sourceFingerprint 追溯），产出 EquityPoint[]/Trade[]/AuditTrail
> 供 C-16.1 消费；单测新增 17；research+researchDataset+backtest 498 全过、tsc 干净）已达 **`CODE_READY`**。
> 禁止裸 signal→next close 的纪律由端到端 T+1 用例（T 信号 T+1 开盘成交）实证守卫。
> **`VALIDATED` 依赖数据链就绪后认证**。C-14.2/C-14.3/C-16.1 依赖本任务。
>
> **C-15.1 状态推进（2026-09-07 00:17）**：STEP 15 编码任务 `C-15.1`
> （`server/research/strategySchema/` 策略 Schema + 版本化：StrategyDocument §16 全字段结构化 +
> StrategyVersionRecord §17 九项追溯 + 声明式 entry/exit/sizing/risk rules + bump 语义（结构→major、
> 参数→minor）+ compare/validate/serialize 指纹 + Strategy13 配方引用兼容映射；单测新增 28；
> research+researchDataset 443 全过、tsc 干净）已达 **`CODE_READY`**。
> 生命周期状态机排除（C-21.1）；dataset version 校验 `rd-…` 形态对齐 C-12.6.1。
> **`VALIDATED` 依赖数据链就绪后认证**。C-21.1/C-22.1 依赖本任务。
>
> **C-14.2 状态推进（2026-09-07 00:40）**：STEP 14 编码任务 `C-14.2`
> （`server/research/costModel14/` 成本模型专项：市场冲击显式建模（订单量 vs 流动性平方根律近似，
> 流动性无效响亮拒绝）+ 成本声明 schema（A 股默认税率万 2.5/0.05%/0.001%/滑点 10bp）+ 单笔五维分解
> commission/stamp/transfer/slippage/impact + engine CostModel 双向映射；STEP 8 cost 原子函数
> import 只读复用；单测新增 34；35 文件 598 全过、tsc 干净）已达 **`CODE_READY`**。
> **`VALIDATED` 依赖数据链就绪后认证**。
>
> **C-14.3 状态推进（2026-09-07 00:40）**：STEP 14 编码任务 `C-14.3`
> （`server/research/executionConstraints14/` 执行与约束模型：capital/positions/lot/restrictions/
> timing/marketClaims 六分组组合声明 + 16 类 EXCON_* 校验 + →simulator 配置映射 + 17 轴能力矩阵 +
> **诚实 blocker**——perSecurityCap/banned/LIMIT_PRICE 在 C-14.1 链不可执行则值域放行、映射报 blocker
> 绝不冒充已执行；端到端证明 maxPosition/涨停禁买/跌停禁卖生效；单测新增 26；35 文件 598 全过、tsc 干净）
> 已达 **`CODE_READY`**。**`VALIDATED` 依赖数据链就绪后认证**。C-23.1 依赖本任务。
>
> **C-16.1 状态推进（2026-09-07 00:40）**：STEP 16 编码任务 `C-16.1`
> （`server/research/performanceMetrics/` 收益/风险/回撤指标：CAGR 交易日口径（与 STEP 8 算法一致、
> 锚点差异已文档化）+ MaxDD 起止/时长/恢复（DrawdownSegment，儒略日纯函数无 Date 对象）+ 回撤剖面
> 阈值分段 + Recovery Factor（总收益÷|MaxDD|）+ tail risk（下行偏差/连亏段/极值分位数）；退化输入
> 响亮失败无静默 NaN、双指纹防篡改、消费 C-14.1 TradeSimulationRun 产出；单测新增 40；35 文件 598 全过、
> tsc 干净）已达 **`CODE_READY`**。Sharpe/Sortino/Calmar 留 C-16.2、交易质量留 C-16.3。
> **`VALIDATED` 依赖数据链就绪后认证**。C-16.2/C-16.3 依赖本任务。
>
> **协调者消歧补丁（2026-09-07 00:40）**：`costModel14` 与 `executionConstraints14` 均导出
> `DEFAULT_LOT_SIZE`（同值 100）→ 统一出口 TS2308 冲突；从 costModel14/index.ts 顶层移除该常量
> （defaults.ts 保留内部定义），executionConstraints14（执行约束域，一手常量权威归属）为唯一顶层来源，
> 测试改从 defaults import。tsc 复核 exit 0。
>
> **C-16.2 状态推进（2026-09-07 01:26）**：STEP 16 编码任务 `C-16.2`
> （`server/research/riskAdjustedMetrics16/` 风险调整指标：Sharpe/Sortino/Calmar 计算器 + rf 参数化
> （默认 0 无隐藏假设）+ 下行偏差独立实现并与 C-16.1 对照锁定 + STEP 8 sharpeRatio 口径核对等价
> （rf=0 逐位一致）；退化→显式 null；单测新增 19；38 文件 684 全过、tsc 干净）已达 **`CODE_READY`**。
> **`VALIDATED` 依赖数据链就绪后认证**。
>
> **C-16.3 状态推进（2026-09-07 01:26）**：STEP 16 编码任务 `C-16.3`
> （`server/research/tradeQualityMetrics16/` 交易质量与稳定性：WinRate/PF/Expectancy/Trade Count 复用
> STEP 8 computeMetrics（import 只读，逐位一致锁定）+ Turnover/平均持仓/月度年度一致性新建
> （月/年连乘望远镜恒等）+ regime 表现 unassessed 占位（C-22.1 前不编造标签，assessed 扩展槽就位）；
> 单测新增 37；38 文件 684 全过、tsc 干净）已达 **`CODE_READY`**。
> **`VALIDATED` 依赖数据链就绪后认证**。
>
> **C-17.1 状态推进（2026-09-07 01:26）**：STEP 17 编码任务 `C-17.1`
> （`server/research/parameterSearch17/` Grid/Random Search：Grid 桥 STEP 6.3 combinationGenerator
> import 只读 + Random 确定性 mulberry32/Floyd 无放回（样本落 grid 同格点保持可比）+ 稳定参数区判定
> **拒绝高收益坏点**（合格=收益且回撤双门槛，显式非 argmax，坏点率超限 degraded）+ kind=candidate
> 候选策略（非 production，无 promotion 代码）+ SearchRun 完整实验记录（哲学对齐 experimentLineage）；
> 单测新增 30；38 文件 684 全过、tsc 干净）已达 **`CODE_READY`**。
> 克制边界：Rolling 属 C-17.2、PBO 正式判定已有 overfittingAssessment。**`VALIDATED` 依赖数据链就绪后认证**。
> C-17.2/C-18.1 依赖本任务。
>
> **C-17.2 状态推进（2026-09-07 12:26）**：STEP 17 编码任务 `C-17.2`
> （`server/research/rollingOptimization17/` Rolling Optimization：交易日锚定滚动窗 × C-17.1 参数搜索
> → 跨窗一致性（合格区交集显式非 argmax，坏点无论多高收益否决；minEvaluatedWindows=2）→ kind=candidate
> 候选止步不升 Final；RollingOptimizationRun 完整实验记录；单测新增 29；41 文件 777 全过、tsc 干净）
> 已达 **`CODE_READY`**。边界：本任务只做「滚动窗逐窗搜索 + 描述性跨窗一致」，Train→Optimize→Freeze→
> Test→Move Window 三段 WFO 编排属 C-19.1/C-19.2；窗口锚定交易日（研究链路逐日数据流）非日历天
> （STEP 6.5 walkForward 生产形态哲学复用不 import）。**`VALIDATED` 依赖数据链就绪后认证**。
> C-19.1/C-19.2 依赖本任务。
>
> **C-18.1 状态推进（2026-09-07 12:26）**：STEP 18 编码任务 `C-18.1`
> （`server/research/robustness18/` 鲁棒性测试第一批：Cost/Slippage/Parameter/Execution 四轴确定性扰动器
> （各含 ×1 基准、扰动产物必须通过既有声明层 validate）+ 逐扰动重估编排（evaluator 注入）+ 漂移敏感归因
> （收益>5pp/回撤>3pp 阈值，resolveRobustnessThresholds 可配）+ RobustnessRun 完整记录双指纹；单测新增 34；
> 41 文件 777 全过、tsc 干净）已达 **`CODE_READY`**。克制边界：MC/Bootstrap/Trade Order Randomization
> 属 C-18.2（留可加轴扩展槽）、regime 扰动属 C-22.1、不跑真实回测（evaluator 注入测点）。
> **`VALIDATED` 依赖数据链就绪后认证**。C-18.2/C-20.1 依赖本任务。
>
> **C-21.1 状态推进（2026-09-07 12:26）**：STEP 21 编码任务 `C-21.1`
> （`server/research/lifecycle21/` 策略生命周期状态机 + 审计：§23 8 态 Draft→Research→Candidate→Validated→
> Paper→Approved→Production→Retired + 迁移表（相邻前进 + 回退白名单 Production→Research 长程例外 +
> Retired 终态复活=bump 新版本）+ 每次变更四要素（timestamp/reason/experiment/evidence）审计轨迹 append-only
> 篡改断链校验 + 证据门槛（→Validated/→Production 需 datasetGate PASS）+ strategySchema 版本壳层绑定 +
> conceptMap 两套状态机概念隔离（§7 交付成熟度 vs §23 策略治理，唯一 Validated→VALIDATED 有损映射）；
> 单测新增 30；41 文件 777 全过、tsc 干净）已达 **`CODE_READY`**。
> **`VALIDATED` 依赖数据链就绪后认证**。C-25.1 依赖本任务（与 C-22.1/C-24.2 汇合闭环）。
- **2026-09-07 12:40** — 重新整理路线图（聚焦未完成部分）。实查：gate PASS 12/PENDING 5/FAIL 0（`RESEARCH_READY=FALSE`）、DB 快照（C+E 运行中 E 996 股/C 477 股，D 未启动）、代码现状（STEP 12.5~18/21 已 CODE_READY，编码缺口 7 个：C-18.2/19/20/22/23/24/25）。**新增 §48「后续迭代开发路线」**：P0 数据回填收尾（C+E→D→G 质量修复→H gate）→ P1 数据域认证（12.5 VALIDATED→12.6 DATA_READY+VALIDATED→13 VALIDATED）→ P2 编码补齐（7 缺口可并行）→ P3 端到端验证，每阶段含优先级/依赖/范围/验收标准；并标注 R1-R5 风险（gate #6 阈值 5500 需修正、G 行业历史轨迹缺失、OHLCV 5796>5552 对账、BaoStock 串行、C+E 进程不可控）。§44.1/44.2 覆盖式更新至 12:40。

> **C-18.2 状态推进（2026-09-07 14:02）**：STEP 18 编码任务 `C-18.2`
> （`server/research/stochasticRobustness18/` 随机化稳健性：Monte Carlo / Bootstrap / Trade Order
> Randomization 三法 + 分布/CI/尾部概率/基准位置 + 复用 C-18.1 resolveRobustnessThresholds 阈值语义 +
> StochasticRobustnessRun 记录三指纹；seedable PRNG 确定性；block bootstrap/BCa/p 值诚实声明 unassessed/
> 不做；单测 50 例）已达 **`CODE_READY`**。**`VALIDATED` 依赖数据链就绪后认证**。
>
> **C-22.1 状态推进（2026-09-07 14:02）**：STEP 22 编码任务 `C-22.1`
> （`server/research/marketRegime22/` 市场状态体系：Trend/Volatility/Liquidity/Breadth/Sentiment/Index State/
> Limit-up Env 七维 PIT 标签 + 回看窗无泄漏断言 + 数据缺失 unassessed 不编造（Sentiment 无源默认
> REGIME_SENTIMENT_SOURCE_MISSING）+ 复合状态归因 + 适配 C-16.3/C-13.3 regime 占位；单测 51 例）
> 已达 **`CODE_READY`**。**`VALIDATED` 依赖数据链就绪后认证**。情绪维待新增情绪数据表后评估。
>
> **C-19.1 状态推进（2026-09-07 14:02）**：STEP 19 编码任务 `C-19.1`
> （`server/research/walkForward19/` Walk-Forward 滚动窗口划分 + 冻结纪律 + 逐窗编排：交易日锚定
> Train/Test 成对窗口 + gap/embargo 防标签重叠 + 冻结参数下中位数显式非 argmax + 逐窗复用 C-17.1
> runParameterSearch + WalkForwardRun 记录 + 冻结纪律机器检查；OOS 隔离记录留 C-19.2、无 promotion；
> 单测 26 例）已达 **`CODE_READY`**。协调者修复子代理遗留 parameterSetKey 键格式不一致 bug（canonicalStringify
> vs rollingParameterSetKey，统一后者）。**`VALIDATED` 依赖数据链就绪后认证**。C-19.2/C-20.1 依赖本任务。
>
> **C-19.2 状态推进（2026-09-07 14:40）**：STEP 19 编码任务 `C-19.2`
> （`server/research/oosIsolation19/` IS/OOS 隔离记录与归档：WindowResultRecord Train/Test 参数与结果字段
> 分离 + 键白名单/无重叠/参数不回写机器检查 + in-memory append-only 归档账本 + OOS 分段聚合报告（复用
> C-16.1/16.2 指标 + C-19.1 窗口几何/退化口径），描述性对比不下过拟合结论；PBO/因子消融留 C-20；
> 单测 23 例）已达 **`CODE_READY`**。**`VALIDATED` 依赖数据链就绪后认证**。C-20.1 依赖本任务。
>
> **C-23.1 状态推进（2026-09-07 14:40）**：STEP 23 编码任务 `C-23.1`
> （`server/research/paperAccount23/` 模拟账户与持仓：账户/持仓状态机 + T+1 冻结 + 现金账本 + 订单→成交
> 约束 + 六维能力矩阵，复用 C-14.3 约束声明/C-14.2 五维成本/C-16.3 适配，诚实 blocker 仅记录不强制执行，
> 闭环编排留 C-23.2；单测 35 例）已达 **`CODE_READY`**。**`VALIDATED` 依赖数据链就绪后认证**。C-23.2 依赖本任务。
>
> **C-20.1 状态推进（2026-09-07 19:30）**：STEP 20 编码任务 `C-20.1`
> （`server/research/overfittingDetection20/` PBO + 参数敏感性：CSCV 划分+倒置统计+零分布+分位 CI+
> 判定结论 + 参数敏感性复用 C-18.1 扰动集 + Overfitting 聚合判定 + 三类记录 round-trip+篡改拒绝；
> 诚实 CV-PBO/贝叶斯收缩/p-value 不做；命名 Ofd* 避撞 legacy Pbo*/Overfitting*；
> 单测 55 例）已达 **`CODE_READY`**。**协调者纪律修复**：子代理在 types.ts:586-590 重复定义
> C-18.1 的 `DEFAULT_RETURN_DRIFT_THRESHOLD_PCT=5` 与 `DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT=3`
> （违反"复用而非重写"）→ 改为 `import { ... } from "../robustness18"` re-export。
> **`VALIDATED` 依赖数据链就绪后认证**。C-20.2 依赖本任务。
>
> **C-23.2 状态推进（2026-09-07 19:20）**：STEP 23 编码任务 `C-23.2`
> （`server/research/signalToPnl23/` 信号→订单→成交→PnL 闭环编排：主编排器 `runSignalToPnlLoop` 每交易日
> (a) T+1 结算 → (b) 处理 executionTime 到期订单（checkPaperOrder + applyBuy/SellFill + 失败 unfreeze）
> → (c) 决策日 planDecisionDay + freezePaperCash → (d) mark-to-market；价格源 + 信号选择器注入式；
> 复用 C-13.2 候选记录/C-23.1 8 原语/C-14.2 五维成本/C-14.3 17 轴能力矩阵/C-14.1 planDecisionDay（绝不重写）；
> PIT 守则：决策日 D 的订单 executionTime = D+1，D+1 成交价严格取 D+1 open（不取 D close，防 look-ahead），
> 冻结金额用决策日 close 算；toTradeQualityEvaluationInput 直接构造 C-16.3 输入；
> 单测 18 例）已达 **`CODE_READY`**。**`VALIDATED` 依赖数据链就绪后认证**。C-24.1 依赖本任务。
>
> **C-20.2 状态推进（2026-09-07 22:53）**：STEP 20 编码任务 `C-20.2`
> （`server/research/factorAblation/` 因子消融与 OOS 退化：四模式 REMOVE_SINGLE/LEAVE_ONE_OUT/
> CUMULATIVE_REMOVE/FORWARD_ADD + evaluator 注入 + **IS/OOS 双轨消融对照**（同套消融目标分别在
> IS 与 OOS 执行，OOS 段只读不参与筛选）→ 机器可读过拟合信号候选 ABL_IS_POS_OOS_NEG/NEUTRAL
> （描述性归因非因果）；成分贡献排序显式非 argmax；与 C-20.1 Ofd 汇合适配（真实 OVERFIT 已测）；
> discipline 审计五断言；诚实边界：p 值/贝叶斯/自动剔除重训不做；
> 单测 45 例）已达 **`CODE_READY`**。**`VALIDATED` 依赖数据链就绪后认证**。
>
> **C-24.1 状态推进（2026-09-07 22:53）**：STEP 24 编码任务 `C-24.1`
> （`server/research/tradeJournal/` 交易日志与复盘：TradeJournalEntry planned/actual 事实分离 +
> `reconcilePlanVsActual` 机器核对（数量/价格/时机偏差，actual 早于 planned 响亮拒绝）+
> AnnotationBlock 人工受控词表 **零生成**（reason/emotion/ruleViolation 由人注入，draft=null）+
> append-only 账本 supersedes 修订链（篡改/回退/断链拒绝）+ `buildJournalDraftsFromRun`
> （从 C-23.2 SignalToPnlRun 逐订单提取，来源指纹复核）+ PostReviewRecord 复盘快照；
> PIT 时间序校验（decision≤执行日≤成交≤标注/入账）；诚实边界：跨交易聚合/纪律打分留 C-24.2；
> 单测 29 例）已达 **`CODE_READY`**。**`VALIDATED` 依赖数据链就绪后认证**。C-24.2 依赖本任务。
>
> **C-24.2 状态推进（2026-09-08 22:53）**：STEP 24 编码任务 `C-24.2`
> （`server/research/disciplineFeedback/` 纪律反馈分析：`aggregateViolationCauses` 违规原因统计 +
> `detectRepeatMistakes` 重复错误识别 + `rankExecutionQuality` 最差执行策略排序 +
> `identifyErrorProneEnvironments` 易错环境识别（regime/环境标签注入不自算，无标签归 ENV_UNLABELED）+
> `buildDisciplineFeedbackRun` 主编排（输入账本指纹→四类聚合→模式清单→9 分支诚实结论
> stable/patternsFound/inconclusive+reasonCode）；复用 tradeJournal 词表/校验零重定义；
> 诚实边界：未标注 draft 不计原因、样本不足不排名、不生成处方/不做因果、与 C-22 真实挂接留 C-25.1；
> 单测 38 例）已达 **`CODE_READY`**。**`VALIDATED` 依赖数据链就绪后认证**。C-25.1 依赖本任务
> （与 C-21.1/C-22.1 汇合闭环，STEP 24 链至此全通）。
>
> **C-25.1 状态推进（2026-09-08 23:25）**：STEP 25 编码任务 `C-25.1`
> （`server/research/closedLoop/` 闭环整合：§27 14 阶段链契约 + handoff 摘要流转 +
> 注入式执行器 + BLOCKED 诚实门禁 + lifecycle 证据门槛（无 datasetGate PASS 不推进）+
> §28 谱系挂载 + synthetic 标记；编排器只做契约/流转/审计/记录，阶段算法全部注入实现，
> 直接相对路径 import 兄弟模块防循环）已达 **`CODE_READY`**——**编码链 G2 完结：29/29
> 全部 CODE_READY**。**`VALIDATED`/`PRODUCTION_READY` 依赖数据链就绪后认证**（接真实
> executor/DB 属 VALIDATED 阶段）。
>
> **DS-V2-FINAL 状态推进（2026-09-09 23:10）**：正式链真实 E2E 跑通 → **`VALIDATED`**。
> ① 新增 C-12.6.3 certification / C-12.6.4 capability / C-12.6.5 preview（`server/researchDataset/`，
> 单测 57 例全过）→ **`VALIDATED`**（真实 TiDB 认证判定：dataReady=false→CONDITIONAL、
> dataReady=true 且 baseline 仅需 OHLCV→**CERTIFIED** researchSafe=true）。② C-12.6 builder 行排序 bug
> 修复（`(tradeDate,securityId)` 升序）后两次构建 datasetVersion 一致 → **`VALIDATED`**（确定性实证）。
> ③ C-13.1 bind / C-13.2 signalEngine / C-14.1 simulator / C-16.x metrics 经正式链 E2E（5 候选日
> 25618 行 25 槽 9 笔 权益 1019749.99）→ **`VALIDATED`**。④ Research Run 强绑定三列（migration 0025）
> 落库实证：`RUN-EXP-E2E-B9F42F-D4D1` datasetVersion=`rd-1.0.0-1-fd1c487f2fe19e27`。⑤ C-17/18/19/20
> （paramSearch/WFO）仍 **`CODE_READY（R7）`**——未绑定正式 Dataset（技术预览口径）。⑥ gate 刷新：
> G0 PASS / G1 GAP（industry 单点）/ G2 PASS（research_datasets≥1）/ G3 GAP（引擎 SELL 待 P3-T1 已
> CODE_READY 未 VALIDATED）/ G4 PASS（research_runs≥1）/ G5 GAP → **`RESEARCH_READY = TRUE`**（G4 弱证据，
> OOS/overfitting 未接正式链，强语义待 P3）。

## 44.5 下一任务队列（§38 优先级）

> 完整的分阶段开发路线、依赖关系、范围与验收标准见 **§48**。此处仅为即时动作队列。

> 🔴 **编号台账（禁「末条 +1」）**：编号已用至 **`9ci`** ⇒ **下一个未占用 = `9cj`**。已完成的 `1~9` 与 `9a~9bh`、以及第 10~27 项中的 ✅ 已完成项，已**全部移入 `ROADMAP-CHANGELOG.md`**（原样搬运）。本项目历来按「**下一个未占用**」取号，**禁按「末条 +1」推算**。
> 检索已归档条目：`grep "9a" ROADMAP-CHANGELOG.md` 或直接 grep 任务 ID。

5. ~~G 数据质量修复 + H gate 重跑~~ ⏸️ 部分完成（gate 17/17 全 PASS、`RESEARCH_READY=TRUE`；G 的 securityId 全 NULL + effectiveFrom 单点两质量待办仍 PENDING，属 STEP 12.5 PIT 审计前必修 → §48 P0-3）

7. **（业务数据待办，02:50 登记）limit_up_records 6,518 条名称对齐**：当日真实 10% 涨停但名称被回填套上当前 ST 名（208 只，清单 `scripts/backup/st_name_fix_targets.json`）。需 Tushare namechange 改回当日真实名称；实测限频 **1 次/小时**（当前 token 档位），约需 208+ 小时。工具就绪（provider + 清单），待更高积分 token / 配额放宽后执行（用户选定暂缓）。

- **9ci. （EXP-001 · 首板后回踩第一性研究 · 独立实验首次真实投产）** ✅ **已完成（2026-09-21）**：第一次用已完成的独立实验基础设施（`9ch` / RESEARCH-EXPERIMENT-004）解决**真实量化研究问题** —— 首板（首次涨停）之后 T+1～T+5 的价格路径、回踩行为、回踩深度、**是否跌破首板日开盘价**，以及不同观察 / 入场时点之后的后续表现。**前置 `9ch` 已 COMPLETE**。
  **① 交付面**：新实验目录 `research-experiments/first-board-pullback/fundamental-study/`（`result.ts` 结果组装 / `experiment.ts` 取数与逐事件评估 / `page.tsx` 前端页 / `README.md` 口径说明），两处注册同步（`research-experiments/manifest.ts` + `client/src/researchExperiments/pages.ts`）。**零迁移、零新依赖、零 tRPC 路由改动、零 DB schema 改动**（未动 Research Core / Strategy Core）。
  **② 真实 Run（真库 + 真 Dataset + 真 MinIO）**：`RUN-20260920-2A91D7C2`，`COMPLETED`，`durationMs=135389`；Dataset `first_limit_pullback` v2（`datasetVersionId=390002`，声明事件 23978）；产物 **10 个对象**（`result.json` 71370 B + `manifest.json` + 5 CSV + 2 SVG + `logs/run.log`），逐个 `exists()` 实测存在且绕开服务层列举 MinIO 前缀复核。
  **③ 核心数字（全部真机实测）**：候选 20000 / 入池 19877 / 剔除 123（全部 `INVALID_OBSERVATION_OHLC`）；截至 T+5 曾回踩 **85.53%**（17001）、**始终未跌破首板日开盘价 66.77%**（13272）、曾跌破 **33.23%**（6605）；逐日回踩率 T+1…T+5 = 68.93 / 67.17 / 63.88 / 63.92 / 63.50%；截至不破位率 = 90.91 / 83.51 / 77.12 / 71.42 / 66.77%；回撤分桶 6 桶（`DD_500BP` 最大 23.52%）；**不破组 vs 破位组中位收盘收益差 T+5/T+10/T+20 = +0.1082 / +0.1009 / +0.0951**（方向一致、量级稳定）。观察 **17 条**（DESCRIPTIVE/COMPARATIVE/POTENTIAL_SIGNAL/LIMITATION 四类齐备，越界句 0）、假设 H1/H2/H3、`selectionNotes` 8 条；**不产出任何 Strategy / Candidate / 参数结论**。
  **④ 性能**：`actualQueryCount = 21`（rd=0 一次 + 20 个观察日各一次）vs `naiveQueryCount = 420000`，即 **1 : 20000**；单测用读取层调用日志钉死「禁 N×M 逐事件逐日查询」。
  **⑤ 本轮发现并修复的 5 条真缺陷**：⑴ 读 `values.tradeDate` 当行身份字段 ⇒ `values` 只含声明列 ⇒ 恒 `undefined` ⇒ **全部样本被误剔**（结果只像「样本量为 0」）；⑵ 观察句里「曾跌破的占比」误用**当日**破位率 ⇒ 同句「未跌破 66.77% + 曾跌破 26.23%」**加起来不到 100%**；⑶ 🔴 **样本账缺口 3978 未登记** —— 数据集声明 23978、本轮候选 20000，差额**既不在候选也不在剔除**，而平台守恒式 `eligible+excluded=candidate` 对「压根没进候选」的事件恒真、毫无保护 ⇒ 新增 `candidates.unscannedEventCount` + 页面首屏告警 + `notes` + `LIMITATION` 观察四处登记；⑷ 规范 `EXPERIMENT-CODE-SPEC.md` **§P.3 代码示例与 §P.5 映射表自相矛盾**（示例写 `name: "tables/x.csv"`，映射表却显示 `name` 不含角色段）⇒ 真机产物落成 `tables/tables/x.csv`，四处修正（`result.ts` / `experiment.ts` / 规范 / `template/README.md`）+ E2E 新增「角色段不重复」回归闸；⑸ 🔴 **修了 ⑷ 却漏掉作者面模板** `research-experiments/template/experiment.ts`（那次演示 `artifact()` 仍写 `name: "tables/group-counts.csv"`）⇒ **照模板复制的新实验会集体踩 ⑷**，而发现时 202 例单测全绿也没抓到（没有任何测试真机跑过模板）⇒ 修正演示调用 + **新增全仓静态扫描回归闸**（扫 `research-experiments/**` 代码行、跳过注释行，禁 `name: "<角色段>/…"`），并**实测可红**（改回错误写法立刻报 `template/experiment.ts:144`）。
  **⑥ 验证**：`tsc --noEmit` **0 error**；`pnpm run build` **exit=0**；`test:changed` **零新增失败文件**；定向 `vitest run tests/server/researchExperiments` **11 文件 / 203 例全绿**；`legacyFreeProductionChain` Gate **7 例 PASS**；`checkEolDrift.mjs` 漂移 **0**；EXP-001 单测 **62 例全绿**；真实 E2E **20 步全 PASS**（含新增 0b 无在途 Run 前置闸 / 5b 账目缺口 / 9b 角色段不重复）。
  报告 = `docs/research/EXP-001-final.md`（21 节）；E2E = `docs/evidence/_e2e_9ci_exp001.mts`；数字探针 = `docs/evidence/_probe_9ci_exp001_numbers.mts`；**前端可达性探针 = `docs/evidence/_probe_9ci_exp001_frontend.mjs`**（无头 Edge + CDP 量 DOM，走**完整真实用户路径**：列表页 → 点「打开」→ 详情页 → **真点一次「运行」** → 自定义结果页 → 点「打开这一条 Run」→ RunDetail）= **42 PASS / 0 FAIL**（新 Run `RUN-20260920-902A6515`；首屏「样本账有缺口」告警条实测渲染且可见，取最内层命中盒 textLen=151；越界措辞句子级扫描 462 句 / 2621 句均为 0）。🔴 **第一次跑是 15 FAIL，根因是探针自身假设错（不是产品缺陷）**：⑴ 实验**详情页不会自动渲染历史 Run** —— 结果区条件是 `outcome !== null`，而 `outcome` 只来自**本次会话的 `runMutation`** ⇒ 验证自定义结果页**必须真点运行**；历史 Run 走 `/…/runs/:runId`，而 RunDetail **刻意不重建 execution** ⇒ 走通用渲染器、不挂自定义页面（第一版探针因此得 15 条假 FAIL）；⑵ 侧栏导航项**不是 `<a href>`**（`AppShell.tsx` 用 `SidebarMenuButton` + `onClick`）⇒ 旧判据 `a[href="/research-experiments"]` 永远查不到，正确锚点 = `[data-sidebar="menu-button"]` + `data-active`；⑶ 观察类别在 DOM 里渲染为**中文标签**（描述性事实 / 分组比较 / 值得进一步验证 / 局限），枚举码 `DESCRIPTIVE / …` **从不进 DOM**；⑷ 「免责声明不得删」**适用范围已收窄为研究侧强制件**（首页梯队区块 / 结论正文），**独立实验页从未要求挂免责声明**，旧判据恒假。四条均已登记在报告 §19.4 与 `docs/evidence/README.md` 的 `9ci` 节。**未做（如实登记）**：行业 / 市值 / 板块中性化（`boardType` 在 v1/v2 全为 `main`，做了是伪信息）、T+20 之后后续表现（post 物理视界 rd ≤ 20）、显著性 / 稳健性 / OOS、入场日视角 `next20`（结构不可用）。**停在 EXP-001 COMPLETE，未自动开始下一步研究或策略工作。**

- **9ch. （RESEARCH-EXPERIMENT-004 · 独立研究实验持久化 + MinIO 产物存储）** ✅ **已完成（2026-09-20）**：把独立研究实验从「**请求内计算、刷新即丢**」推进到「**Run 元数据落 TiDB、结果与产物落对象存储、关页面重开仍可查看历史 Run**」。
  **① 建表**：`research_experiment_run`（20 列 / 3 索引 / 零 FK / 手工幂等 migration `0047`）。🔴 **不建 `experiment` 表**：Experiment 元数据是代码声明（`research-experiments/manifest.ts` + `registry.ts`），再建表会出现两个真源；历史可读性由快照列（`experimentName`/`experimentVersion`/`datasetCode`/`datasetVersionLabel`/`parametersJson`）兑现。
  **② 存储端口**：`server/artifactStorage/**`（`ArtifactStorage` 六方法 + 闭集错误码 + `MinIOArtifactStorage` + `InMemoryArtifactStorage` 作**测试唯一替身**）；实验代码**零 MinIO SDK 依赖**；`@aws-sdk/client-s3` **零新依赖**。
  **③ 生命周期**：`PENDING → RUNNING → COMPLETED | FAILED`；**上传 → `exists()` 复核 → 才置 COMPLETED**；失败一律 `markFailed`（不留 RUNNING 悬挂）；`reconcileRun` 供人工收敛。
  **④ 前端**：列表页 状态 / Latest Run / 最近运行时间；详情页「运行历史」卡片；新路由 RunDetail（Status/Dataset/Parameters/Started/Completed/Duration/Result/Artifacts 全备）；产物**按需**加载（初始化 0 请求）。
  **⑤ 两条真缺陷**：`NoSuchBucket` 误判导致自救提示不可达；Run 读路径缺 `withReadRetry` 兜底导致冷启动 500。
  **⑥ 验证**：`tsc` 0 错 / `build` exit=0 / `test:changed` 零新增失败文件 / 定向 141 例全绿 / 真库真 MinIO 12 步 E2E 全绿 / 前端 CDP 46 PASS / 行尾漂移 0。
  报告 = `docs/research/RESEARCH-EXPERIMENT-004-final.md`；migration = `drizzle/0047_experiment_run_persistence.sql`；E2E = `docs/evidence/_e2e_9ch_experiment_persistence.mts`；前端探针 = `docs/evidence/_probe_9ch_experiment_persistence_frontend.mjs`。

- **9cg. （RESEARCH-EXPERIMENT-003 · 旧 Research 体系彻底删除）** ✅ **已完成（2026-09-20）**：把
  `Research → Analysis → Finding → Conclusion` 从「LEGACY 只读」推进到**整体退役** —— 服务端两层实现、
  旧 API、前端入口、数据库表全部离场；研究入口只剩 `Independent Experiment`。
  **① 删除面**：`server/researchCore/**`（12 文件：conclusions / findings / hypotheses / results / executionLog /
  config / repository 四文件）+ `server/researchEngine/**`（47 文件：engine / analyses / finding / planner / report /
  variables / sampleSet / templates / maintenance / reclaim / metrics / semanticProjection …）+
  `researchEngineRouter.ts`（1251 行 / 38 端点）+ `researchPlannerRouter.ts`（897 行）+ `researchChainHealth.ts`
  （`researchRun.chainHealth`）+ STEP 6.x 旧链路 22 个文件（experiment/run/sweep 服务与 TVO/PBO/WFO 评估链、
  `persistence/**`）+ 桥的 `evidenceDerivation.ts` / `evidenceTrace.ts`。
  **② 搬迁（逻辑逐字未改）**：`researchCore/types→research/vocabulary`、`candidates→candidateRules`、
  `conditions→conditionSet`、`serialization→jsonCodec`；`researchEngine/datasetReader→researchRuntime/datasetReader`、
  `columnProjection→researchRuntime/datasetColumns`（只留 `STRUCTURAL_COLUMNS` 等常量）、
  `types→researchRuntime/versionContext`、`planner/moduleRegistry→patternLibrary/moduleRegistry`；
  候选仓储**新写** `research/candidateRepository.ts`（只服务 `research_strategy_candidate`，DB + InMemory 同语义，
  **不提供 `create`** —— 旧 create 的两条父引用校验指向已归档表，该写入路径结构上不再成立）。
  **③ 旧 API 与命名空间**：`research.*` → `strategyDomain.*`（文件改名 `researchRouter.ts → strategyDomainRouter.ts`；
  11 个前端文件 + 2 处 `inferRouterOutputs` 索引同步）；删除 `researchEngine` / `researchPlanner` 两个挂载点。
  **④ DB**：手工 migration `drizzle/0046_legacy_research_retire.sql`（**零 DML**）—— 5 张零行表
  （`research_analysis_metric` / `_template` / `_template_item` / `research_experiments` / `_batches`）DROP；
  12 张有历史行的表 RENAME 为 `archive_research_*`（数据一行未动）；`drizzle/schema.ts` 移除 17 个旧表对象。
  保留：`research_strategy_candidate`（§4 允许的过渡实体）/ `strategy_research_provenance`（§6 provenance）/
  `research_datasets` / `research_securities` / `research_security_*_history`（Dataset 与证券身份域）。
  **⑤ 前端**：10 条旧路由（`/research*` `/findings*` `/conclusions*` `/candidates` 列表）+ 19 个旧工作台组件 +
  9 个纯函数模块 + `adapters/researchEngineAdapter.ts` 删除（其中仍被生产使用的 3 个函数迁到 `lib/displayFormat.ts`
  与 `lib/rpcDiagnostic.ts`）；侧栏「研究」分组 **7 → 2**（`独立实验` + `数据集`）；修掉一处指向已删路由的链接。
  **⑥ 两个真踩（都会误导下一个会话）**：① `applySqlMigration.mjs` 的 `@guard` 语义是「**目标已存在即跳过**」
  ⇒ 给 `DROP TABLE` 配 `@guard: table <要删的表>` 会**永远删不掉**（第一次实测 5 张表全 `skip-exists`，
  修法是该段**不加 guard**，靠 `DROP TABLE IF EXISTS` 自身幂等）；② 误用 `git checkout -- drizzle/schema.ts`
  会**覆盖并行会话（002）的未提交改动**（本轮真丢过 `strategy_research_provenance` 的 5 新列 + 3 放宽，
  已按 `0045` 原文恢复）⇒ **改既有文件前先备份到仓外**。
  **⑦ 验收**：`tsc --noEmit` **0 error**（69→41→11→1→0）；migration `pass:true` + 复跑幂等；
  执行后 DB 实查「5 DROP 残留 0 / archive 12 / 保留表 4」。**未做（如实登记）**：生产链真机 E2E 与
  「外部 AI 接入 E2E」本轮**未重跑**；`vocabulary.ts` 仍保留旧实体**类型声明**（无实现）；
  `patternLibrary` 的 `research` 投影已无运行时消费者；候选**无创建入口**（表内 13 行只能查看/编辑/流转/转正）
  ⇒ 以上四条列入 004。
  报告 = `docs/research/RESEARCH-EXPERIMENT-003-final.md`；migration = `drizzle/0046_legacy_research_retire.sql`。
- **9cf. （RESEARCH-EXPERIMENT-002 · 生产链迁移与旧 Research 解耦）** ✅ **已完成（2026-09-20）**：把「Old Research 是否被生产链依赖」
  从**口头结论**变成**可执行的图可达性判据**，并把两条真实传递依赖切断。 **① 依赖地图（A~E 分类，全部来自真实代码）**：真正生产依赖只有两条 ——
  `strategyCandidate/service.ts#createFromConclusion` 的硬前置（必须有 conclusion/experiment/Dataset READY/状态 ∈ {DRAFT,FINAL}）与
  `strategy_research_provenance` 三锚 `notNull`；其余为 **B UI 依赖**（旧 11 + 38 个端点）、**C 历史数据**（零删除）、**D 兼容层**
  （`evidenceDerivation` / 启动期孤儿回收 / `researchEngine/datasetReader` 读取层）、**E 归 003**（`research/index.ts` 连带加载复数表仓储）。
  **② 传递依赖实测与切断**（🔴 逐文件 grep 看不到，必须走图）：`assemble.ts → patternLibrary/strategyConsumption →
  patternLibrary/index →（**`export … from` 再导出**）→ project → researchEngine/planner/moduleRegistry`；`server/db.ts → researchEngine/readRetry`。
  修法 = 纯查询下移 `patternLibrary/catalog.ts`（`index.ts` 继续再导出 ⇒ **导出面零破坏**）+ `withReadRetry` 搬到 `server/readRetry.ts`
  （旧路径保留转出口 ⇒ 既有 import 零改动）。**判据**：`entries=14` 的可达集里旧 Research 文件 **2 → 0**；到 `researchCore`/`researchEngine` **不可达**；
  从 `drizzle/schema` import 旧表对象 **0**。⚠️ **判据工具本身也犯过错**：第一版正则抓 import 漏掉 `export … from` ⇒ **假 PASS 一次**；改 AST 后才看清。
  **③ Strategy 迁移（Experiment Result → Strategy）**：新增桥 `server/researchExperiments/strategyBridge.ts` + 写端点
  `experimentStrategy.createFromExperiment`（admin）—— **复用**既有唯一 `Candidate → StrategyDefinition` 转换器（`definitionBuild` 三函数）与既有
  幂等创建路径（`StrategyPromotionPort.createStrategyVersion` ⇒ canonical 组装 + 5 投影 + Dataset 绑定校验全都复用）；**不建候选行、不要求任何旧 Research 行**；
  `StrategyDefinition` / `StrategyCoreDefinition` / `StrategyVersionRecord` **零改动**（`grep` 三处零命中）。桥是**有意的边界层**（同 `strategyCandidate/**` 纪律），
  其「旧行形状载体」由两条**补偿断言**钉住（旧字段只允许取 `null`/`0`，见 `manifest.test.ts` 与 `legacyFreeProductionChain.test.ts`）。
  **④ Experiment provenance**：手工 migration `drizzle/0045_experiment_provenance.sql`（**零 DML**：5 ADD COLUMN + 3 `MODIFY … NULL`）落在既有**溯源独立切面**
  `strategy_research_provenance`（display-only：不参与定义/指纹/投影/校验/回测/参数搜索/执行）⇒ 不可能影响任何计算口径；
  `sourceKind` 带 `DEFAULT 'RESEARCH_CONCLUSION'` ⇒ 既有 9 行**无需 backfill**即语义正确；新增 `experimentRef` / `experimentVersion` /
  `experimentParametersJson` / `experimentResultDigest`。§6 六问逐条有答案；digest 由**服务端真实重跑后**算出（非调用方自报）；
  `sourceKind=INDEPENDENT_EXPERIMENT` 时三个旧锚**结构上必须为 null**（填真实 id 即抛 `INVALID_INPUT`）—— 「不伪造来源坐标」成为可断言事实；
  上游存活探测**按体系分派**（只探测非空锚 + 独立实验另探测注册表；未注入注册表时**不探测也不谎报**）。
  **⑤ 生产链逐域审计**：PS / OOS / WFA / Robustness / Backtest / Paper / Review 对旧 Research **直接依赖均为零**（各域只读自己的表 + Strategy Version + Dataset Version）；
  顺带验证「死参数守卫真实生效」：对规则图未引用的 TUNABLE 赋搜索域会被 `PARAMETER_SEARCH_OVERRIDE_ON_UNREFERENCED_PARAMETER` **响亮拒绝**。
  **⑥ 真实 E2E（两段，全部真库）**：`bridge` **11 PASS / 0 FAIL**（实验真实执行 15.9 s、策略版本真实落库、溯源六问齐全、旧七表 Δ=0）；
  `chain` **9 PASS / 0 FAIL** —— PS 2 组合 **2 个不同指纹**（6.4 s）→ **Backtest 两组合 `backtestFingerprint` 互不相同**
  （`6b2c6999…` vs `2495d375…`，证明真跑了两次回测且参数进入撮合）→ OOS `COMPLETED` → Robustness `COMPLETED` → WFA `COMPLETED`（**2/2 Fold**）→ 全链八表 **Δ=0**。
  **⑦ Legacy 边界**：删旧 Analysis / Finding / Conclusion 的 Gate = `tests/server/research/legacyFreeProductionChain.test.ts` 四条断言
  （无旧目录可达 / 无旧表对象 import / **入口清单必须真实解析到**防假通过 / **旧 Research 子图确实存在**防空断言）。**前端**：修掉一处生产误跳
  （稳健性面板 `href="/research?searchRunId="` ⇒ 改走既有 `buildPanelLocation`）、新增 `LegacyResearchNotice` 并挂 5 个旧页面（只替换 return 最外层开标签 ⇒ JSX 结构零改动）、
  侧栏旧 5 项标注「（Legacy）」、正式入口 = `/research-experiments`。 **⑧ 边界与遗留（如实登记）**：`researchRun.loopRun(useRealData=true)` 在本策略上被
  `coreDecision` 决策源前置挡住（`resolvedParameterSet 尚未产生`，与旧 Research 无关、规格禁改 Backtest）⇒ 改用 PS 回测指纹作 Backtest 主判据并记入剩余风险；
  该入口的 `experimentId` 仍是旧格式 `EXP-YYYYMMDD-XXXXXXXX`（装不下 `<group>/<key>`，独立实验身份由 provenance 承载）；旧 Research 写端点未删（规格禁删）⇒ 列入 003。
  报告 = `docs/research/RESEARCH-EXPERIMENT-002-final.md`；Gate 探针 = `docs/evidence/_probe_experiment_legacy_reach.mts`；E2E = `docs/evidence/_e2e_experiment_strategy_chain.mts`。
- **9ce. （RESEARCH-EXPERIMENT-001 · 独立研究实验体系 + AI 接入规范）** ✅ **已完成（2026-09-20）**：把「研究」从固定形态的
  `Research → Analysis → Finding → Conclusion` 之外开出**第二条链**：`Independent Experiment → Experiment Result → Experiment Page`。
  **旧链路零删除、零改动**（规格 §14），新实验**不得**强制转成旧结构。 **① 独立 Contract**（`shared/researchExperimentsContracts.ts`，
  wire schema + **作者契约**同文件）：`ExperimentDescriptor`（元数据 / `parameters[]` / `datasetRequirement` / `pageKey`）·
  `ExperimentDefinition`（descriptor + `resultSchema`(zod) + `run(context)`）· `ExperimentRunContext`（descriptor / parameters /
  `dataset` 取数句柄 / `log()`）· `ExperimentResultPayload`（`sampleSummary` 必填 + tables / statistics / distributions / comparisons /
  charts / `customPayload` **全部可选**）· `ExperimentRunOutcome`。🔴 **作者契约刻意放 `shared` 而非 `server`**：实验目录层级不固定
  （模板 2 层 / 示例 3 层），相对 import 会因**复制目录**而 `TS2307`（本轮真踩一次）⇒ 一律 `import type … from "@shared/researchExperimentsContracts"`，
  **与深度无关**。**② 与旧结构的隔离做成可断言事实**：静态测试按**结构形态**（字段声明正则 + 表名字符串字面量，**不认裸子串** —— 注释里
  刻意引用了这些词作「禁止」说明，裸子串断言会命中否定式说明而证明不了任何事）扫三处源码。 **③ 最小 Registry**（`server/researchExperiments/registry.ts`）：
  注册即校验元数据（9 条），重复注册具名拒绝；**显式清单**两处各 +1 行（`research-experiments/manifest.ts` 服务端 +
  `client/src/researchExperiments/pages.ts` 前端页面），**不改核心引擎的 switch/case**；沿用仓库既有「无目录扫描 / 无 `import.meta.glob`」约定
  （规格 §11 明确允许最小 Registry），并把「无 glob / 无目录扫描 / 无文件 IO」也变成静态断言。 **④ Experiment Runner**（`runner.ts`）：
  `load → validate（参数+默认值归并）→ resolve dataset（版本事实/READY/代码匹配/视界）→ execute → capture result（信封+自有 schema+样本账）
  → capture error → return execution metadata`；🔴 **两类失败两条出口**：**执行前**可判定（未注册/参数非法/版本非 READY/相对日超视界）⇒ **抛领域错误**；
  **执行中**发生（`run()` 抛异常 / 结果不符 schema / 样本账不平）⇒ **返回 `FAILED` outcome**（`result:null` + `error` + 完整执行事实，含耗时/坐标/参数/日志）。
  **⑤ Dataset 桥**（`datasetPort.ts`）：复用 `ResearchDatasetReader`（Research 侧唯一读取层）与 `DatasetDataReader`，**不另写 SQL**；
  **列投影 = 骨架列 ∪ 声明列**（骨架列复用既有唯一权威 `server/researchEngine/columnProjection.ts#STRUCTURAL_COLUMNS`，本轮为复用把它 `export`）；
  **相对日白名单**（未声明调用即抛）；**`usesForwardData` 结构级 PIT 闸门**（未声明却读 rd≥1 ⇒ `EXPERIMENT_FORWARD_DATA_FORBIDDEN`）；
  声明不存在的列 ⇒ 当场拒（否则 Drizzle 列裁剪会把写错的列静默变 null）；声明的 rd 超该版本真实视界 ⇒ **拒且不夹取**。
  **⑥ 结果契约**：信封由平台 zod 校验、`customPayload` 由实验自己的 `resultSchema` 校验；**数值「算不出就是 null」禁 0 兜底**；
  🔴 **样本账强制平**（`eligible+excluded=candidate` 且 `Σ excludedByReason === excluded`，不平即 `EXPERIMENT_RESULT_INVALID`）—— 这是「样本为何变少」的唯一诊断线索。
  **⑦ 页面契约**（`client/src/researchExperiments/contract.ts`）：页面只消费 `descriptor` 与 `outcome`，**不自己发请求**（执行入口服务端只有一套），
  静态测试禁其运行时 import `experiment.ts` / `server/**`；`pageKey` 未注册 ⇒ **不白屏**，降级 `GenericExperimentResult` 并明确提示；
  测试**双向**钉住清单 ⇄ 页面注册表（漏登记 / 多余条目都会红）。 **⑧ 前端**：`/research-experiments`（列表）+ `/research-experiments/:group/:key`（详情+运行），
  侧栏「研究 → 独立实验」（与「研究实验 = /research」并存、名称刻意区分）；**Dataset 坐标进 URL**（`?datasetVersionId=`，刷新/分享不丢）；
  参数表单由参数定义自动渲染；**pending 换文案**（「正在运行实验…（读真实 Dataset 并全量计算，可能需要 10~60 秒）」）；
  页面**如实告知「不落库、刷新需重跑」**。 **⑨ AI 接入文档** `docs/research/EXPERIMENT-CODE-SPEC.md`（A~O 全 15 节）：
  含**真实可用列清单**、PIT/`decisionOffsetDays` 规则、身份 ≠ 代码的桥接要求、**错误码全集**、12 条禁止事项、14 条交付前自检；
  自足性判据 = 外部 AI 只读该文档 + Template + Example 即可生成实验。 **⑩ Template + Example**：`research-experiments/template/`（4 文件真实代码，
  `usesForwardData:false` 最安全起点）+ `first-board-pullback/entry-day/`（真实数据；v2 数据集 `maxEvents=400` ⇒ T+1 **399 样本 / 平均 +4.61% /
  中位 +2.44% / 胜率 57.9% / 平均入场位置 +1.58% / 平均最大不利偏移 −6.84%**；含剔除原因中文表与选择偏差登记；**刻意不产出排序/评级字段**）。
  **验收（六层全绿）**：`tsc --noEmit` **0 error**；新增单测 **63/63**（Contract 23 / Dataset 桥 10 / Runner 12 / Router 9 / 清单+边界 9）；
  全量 `vitest run` = **7 失败文件 / 16 失败例 = 既有基线，零新增**（295 文件 / 4982 例）；`vite build` **exit 0**；
  **真实 E2E**（`docs/evidence/_e2e_research_experiments.mts`，走 `appRouter.createCaller`）**28 PASS / 0 FAIL**（墙钟 19.3 s；
  `eventCount=20000`/`prefixRowCount=20000`/`postRowCount=100000`；样本账 100000 = 1996 + 98004 且原因合计相等；
  **同输入第二次执行结果指纹逐字节相等**（canonical JSON 7,479 B）；**24 张严格守恒表 Δ=0**，三个负例前后行数完全一致）；
  **前端 CDP 冒烟**（`_probe_research_experiments_frontend.mjs`）**23 PASS / 0 FAIL**（真实点击运行 → 结果页挂载 `data-experiment-page` + 3 表 + 2 图 + 执行元数据；
  不存在实验显示 `EXPERIMENT_NOT_FOUND` 结构化错误态；控制台无 `No procedure found on path`）。
  🔴 **真机抓到 1 个真实缺陷（单测结构上发现不了）**：列投影只下推「声明列」⇒ 领域映射器回来 `eventId=undefined` ⇒ 按 2 万个 `undefined` 批量取行情**恒 0 行**
  （全部样本以 `MISSING_EVENT_DAY_BAR` 被剔除）；**内存读取层不实现列裁剪**故单测 62/62 全绿而真机全空。修法 = 下推列补齐骨架列；
  回归守卫 = 用记录器断言**下推查询的 `columns` 必须含 identity 列**（唯一能拦住该类缺陷的判据形态）。
  **边界**：**零新表 / 零 migration / 零写口**（`_journal.json` 仍 24 条、末条 `0023_security_identity_unification`）；**Strategy Core 零改动**；
  对既有 `server/**` 的唯一改动 = `columnProjection.ts` 的 `const → export const`（纯导出）；行尾哨兵 **0 漂移**（先 `--fix` 归一化 tsconfig/vitest 后 0）。
  **已知局限（如实登记）**：结果不落库（刷新需重跑）；注册是两处各 +1 行（非文件系统发现）；事件扫描安全阀 20000 且「先读后切」（实验的 `maxEvents` 只减计算不减读取）；
  `postRelativeDays` 为静态声明（数据集视界扩大需同步）；`id`/`createdAt` 等物理列仍可被声明（仅保证「真实存在」，不限制「该不该读」）。
  报告 = `docs/research/RESEARCH-EXPERIMENT-001-final.md`；规范 = `docs/research/EXPERIMENT-CODE-SPEC.md`。
- **9cd. （FRONTEND-FINAL-001 · 量化研究平台前端完整闭环实现）** ✅ **已完成（2026-09-20）**：把「研究 → 策略 → 验证 → 交易」从「一堆能打开的页面」收敛为**可追溯、可深链、可验证**的完整闭环。**基础 = 阶段一只读审计**（`docs/research/FRONTEND-FINAL-001-AUDIT.md`，MISSING 0 / READY 7 / PARTIAL 8 / RISK 1 / P0 3 / P1 8 / P2 8），本条目只记实现面。
  **① P0-1（验证域入口与口径统一）**：新增正式验证域路由 `/validation`（总览）/ `/validation/robustness[/:runId]` / `/validation/oos[/:runId]` / `/validation/walk-forward[/:runId][/folds/:foldIndex]`，全部复用既有 4 个持久化面板（`paramSearch.*`），**零新端点**。为此给三个面板加可选 props（`basePath` / `pathStyle` / `routeRunId` / `routeFoldIndex`，见新文件 `client/src/lib/panelLinks.ts`）：不传 = 与改造前**逐字等价**（query 深链写回 `/parameter-search?xxxRunId=`），独立路由传 `pathStyle` = 改走 **path 式深链**。旧 `/walk-forward`（走 `walkForward.*` **内存态、不落库**）**保留代码但移出侧栏**，页面顶部加**红色降级条**并显式指向 `/validation/walk-forward`（规格 §3.2：同名两个入口不得同时出现在正式导航）。
  **② P0-2（实际消费参数可见）—— 唯一需要动 server/shared 的一项，走「只读投影」**：先追链确认真实产生点 —— 参数解析的唯一发生地是装配层 `server/runWorkbenchAssembly/assemble.ts:678 recipeRuntime.resolveParameters(document.parameters, request.parameterOverrides)`，经评估端口 `strategyEvaluation/evaluate.ts:185/259` 挂到 `StrategyEvaluationResult.parameterSet`，**却被 `strategyEvaluation/backtestBridge.ts:145-174` 构造返回值时丢弃**（调用方只能看到「请求参数」）。修法 = 三处最小改动：**(a)** bridge 返回体新增 `resolvedParameterSet`（直接搬端口返回值，**不重算、不二次解析、不重跑策略**，失败路径 `null`）；**(b)** `parameterSearch/executor.ts` 把它并入**既有** `reproductionJson` 列（该列语义本就是「复现要素快照」；**刻意不加新列** —— 本项目 `db:push` / `drizzle-kit generate` 均禁用，加列需 migration）；**(c)** `searchResult.ts` 新增纯函数 `compareRequestedWithResolved`，在**服务端**算出 `parameterResolution{status,findingKeys}`，前端只渲染。契约 `shared/parameterSearchContracts.ts` 增 `resolvedParameterSet` + `parameterResolutionViewSchema`，`parameterResolutionStatusSchema` = `MATCHED / DIFFERENT / UNAVAILABLE`。🔴 **判据细节**：只逐个比较**请求键**（`Object.is`），解析集**多出的**键（未参与搜索的 FIXED/DERIVED 回落 `defaultValue`）是**预期行为**、记入 `additionalParameterCodes` 但**不计为差异** —— 用整集深比较会把每一条都误判成 DIFFERENT。
  **③ P0-3（现场产生真实留档）—— 口径前置比跑数更重要**：先跑选材探针 `_probe_9cc_strategy_params.mts` ⇒ **11/11 策略版本 `referenced = []`**（`e2eEligible = false`），即仓库**不存在**规则图引用了 TUNABLE 参数的现成版本 ⇒ 按规格 §5.1「不满足则停止真实运行」处理；而项目自己的 `_e2e_walk_forward.mts` 会**自建**带真实参数引用（`bar.volumeRatio LESS_THAN_OR_EQUAL max_volume_ratio`）并**收窄声明域**的合法策略版本 ⇒ 用它跑真实全链并**保留留档**（`WF001_MODE=full WF001_KEEP=1`）：**17/17 PASS，真实执行 92 s**，产出 `oos_validation_run=2 / result=2`、`walk_forward_run=2 / fold=4`、新增 `parameter_search_run=2 / combination=8 / result=4`。**真实读数**：`PSRUN-20260920-e37d9c2a` 两个组合（`max_volume_ratio` = 1 / 1.75）⇒ `tradeCount` **0 → 16**、`totalReturnPct` **−3.65% → −2.59%**、`profitFactor` **null → 1.10** —— 与审计现场那条「4 组合指标逐位相同」的旧 Run 形成**对照**，证明参数真的改变了执行。另 **`resolvedParameterSet` 实测含未被请求的键**（`max_drawdown:0.02` / `require_bullish:0`）⇒ 证明落的是**真实解析集**而非请求回显。
  **④ P1 全 8 条**：**P1-1** 新 `ParameterReferenceCheckCard`（参数列表 / 角色 / **是否被引用** / 业务文案「当前 Strategy Version 没有被执行链引用的 TUNABLE 参数，无法进行有效 Parameter Search。」），数据来自给 `research.strategy.loadBundle` 投影**新增 `referenced` 字段**（复用既有 `collectRuleParameterReferences`，`applied=false` 时 UI 显「不可判定」而非「未引用」）—— 顺带实测 9 个版本 `referencedCodes = []`。**P1-2** `ConclusionPanel` + 新建 `ConclusionDetail` 渲染 §15 五件套；`findingIds` 为空而 `evidenceJson` 有历史 finding 时渲染**「历史证据（Historical Evidence）」**只读区块，**禁止伪造 findingId**（实测真库适用对象 = 3 条）。**P1-3** 新 `PromotionEligibilityCard`（`ELIGIBLE / BLOCKED` + Gate / Current Value / Required Condition / Failure Reason），**直接渲染在候选页上**（不再只藏在 disabled 按钮的 `title`；原弹窗内联说明在 disabled 时**不可达**，已改为指向本卡片）；gate 判据逐条对齐 `strategyCandidate/service.ts` 与 `definitionBuild.ts`。**P1-4** 新 `ProvenanceLink`（`StrategyVersionIdLink` 拆 `<id>@<version>` 直连策略版本；`DatasetVersionLink` 用一次 `datasetRegistry.getVersion` 解析 `datasetId` 后直连数据集版本）并接进 OOS/WF 面板；`OOS → 源 Search Run`、`Finding → 详情`、`Finding → 实验页查看该分析`、`Conclusion → Finding` 全部可点。**P1-5** 新建跨实验列表 `/findings` `/conclusions` `/candidates`（+ `/findings/:id` `/conclusions/:id`），为此给 `researchEngine.listConclusions` / `listCandidates` 的 `experimentId` 放开为可选（按 `listFindings` **既有**模式）+新增 `conclusionId` / `candidateId` / `limit`（仓储层 `contract/db/inMemory` 同步只增不改，函数式/内存两实现一致）。**P1-6** `/parameter-search/:runId` + `?searchRunId=` 双形态深链（`ParameterSearch` 内部 `useParams()` 读路由段 —— **不用 props**，自定义 props 与 wouter `RouteComponentProps` 冲突会报 TS2322）。**P1-7** 侧栏按业务域重构为 `复盘分析 / 研究 / 策略 / 验证 / 交易 / 系统` 六组（原「研究数据」一组 11 项的平铺取消），每项都指向**已存在**路由。**P1-8** **废止** `WalkForwardAnalysis.tsx` 的 `FALLBACK_PARAMETER_SPACE` / `FALLBACK_SPLIT_CONFIG` / 写死日期：`describe` 不可达时 `canRun=false`，按钮禁用 + 入口守卫 + 红色说明，**不再用前端默认值发起真实量化运行**。
  **⑤ P2（7 项）**：新建 `PageHeader`（页面标题 + **面包屑**，`components/ui/breadcrumb.tsx` 此前全仓 0 使用）、`ConfirmDialog`（统一确认；已接进 OOS 的**执行**与**取消**两个重/破坏性操作）、`JsonBlock`（平坦标量对象渲染成**键值表** + 可选原文与复制，替换参数搜索页 4 处 `JSON.stringify` 一锅端）；`VersionDetail` 的 Dataset ID / Dataset Version ID 改为可点击；孤岛路由核查结论 = **无可清理者**（`/dataset-builder`、`/strategy-editor` 为**刻意保留**的兼容 Redirect，`/404` 为错误页）；`runResultAdapter` **不删**（它是 `closedLoopRunAdapter` 的类型来源 + `adapters/index.ts` barrel 导出，删会破坏类型引用）。
  **⑥ 🔴 冒烟实测抓到的真缺陷（非本任务引入，但当场修掉）**：无头浏览器控制台报 `No procedure found on path "describe"` ⇒ `ParameterSearch.tsx` / `WalkForwardAnalysis.tsx` / `ReviewWorkbench.tsx` 三处仍在用**过期的类型断言**（`trpc as unknown as ReturnType<typeof createTRPCReact<XxxRouter>>`，注释称「端点尚未合并进 appRouter」），而端点**早已合并**（`server/routers.ts:329/330/332`）⇒ 请求路径退化成**裸 `describe` / 裸 `journal.reconcile`**，恒 404。后果：FE-6 技术预览块的组合数上限静默落到写死的 64、FE-7 整页「端点就绪门」永远显示**不可达**（即 P1-8 里那套兜底的真实成因）。修法 = 三处改回 `trpc.paramSearch` / `trpc.walkForward` / `trpc.review`；修后 `/parameter-search` 正文由 3034 → **4082** 字符（describe 真的返回数据了），`/walk-forward` 3034→2630（降级条生效）。另修 `PersistedParameterSearchPanel` 结果表 `<>` 裸片段缺 key 的 React 警告（改带 key 的 `Fragment`）。
  **⑦ 验收（全绿）**：`tsc --noEmit` = **0 错误**；`pnpm run build` = **exit 0**（vite 42.7 s + esbuild）；`pnpm run test:changed` = **2 失败文件 / 5 例，全部属既有环境依赖基线（`limitUp` / `limitUp.watch`）⇒ 零新增失败文件**（过程中我自己引入的 1 处回归 —— `compareRequestedWithResolved` 未处理既有单测不传新字段导致的 `undefined` —— 已修并定向复跑 `parameterSearchRun.test.ts` **38/38 PASS**）；**无头 Edge + CDP 前端冒烟 16/16 PASS**（`docs/evidence/_probe_ff1_frontend_smoke.mjs`，16 条路由逐一导航量 DOM，**页面上出现真库真实 id**：`OOSV-20260920-875957a6` / `WFV-20260920-5cceca95` / `PSRUN-20260920-e37d9c2a`，且**零控制台错误**）；**真实留档复核**（`_probe_ff1_backend_verification.mts`，只读 + 走 `appRouter.createCaller` 真 tRPC）确认 API 能读到新增字段与真实 run/fold。
  **⑧ 已知遗留（如实登记，非阻塞）**：⒜ 结论 §15 五件套在**真库 15 条上仍几乎全空**（`findingIds` 有值 0 / `researchQuestion`、`evidenceSummary` 全 NULL）——AR-13 修复只对**修复后新写入**生效，历史留档按「不改历史」保留，故本次交付的是**前端展示能力 + 历史只读兜底**，不是数据回填；⒝ 参数搜索「参数效果」按规格 §4.4 **不做**前端自造指标，只展示真实 canonical 指标差异；⒞ `listConclusions` / `listCandidates` 的 `experimentId` 放宽为可选是为跨实验列表，**未加索引**（当前 15 / 13 行量级无性能问题）。
- **9cc. （Parameter Consumption + Semantic + Provenance + Strategy Projection 四断点闭环）** ✅ **已完成（2026-09-20）**：把任务书给的四个断点一次性收敛，并让**两个闭环同时成立**（闭环一 `Dataset→Research→Finding→Conclusion→Candidate→Strategy`、闭环二 `Parameter Search→Combination→Strategy→Backtest→Evaluation`）。
  **① P0-1 Parameter Consumption —— 审计结论是「链上无断点」**：`combination.parametersJson` → 重算并比对 `parameterHash` → `bridge.evaluate(parameters)` → `evaluateStrategyParameters({parameterOverrides})` → `assembleRunWorkbenchInputs` → **唯一解析点** `assemble.ts:672 recipeRuntime.resolveParameters(document.parameters, request.parameterOverrides)` → 同时喂 `buildSignalBuilder(parameterSet)` 与 `createCoreDecisionSource({parameterSet})`；**覆写优先于默认值** ⇒ 链上零改动（不重构 PS，符合禁令 3）。但抓到**更硬的事实**：`_probe_9cc_strategy_params.mts` 实查 **11/11 个策略版本规则图引用面为空**（9 个声明 3 个 TUNABLE 却引用 0 个，与 `9bt` 的 N-02 一致）⇒ 当时**不存在**能作正例的策略版本，`9bt` 那次「正例」是**手工改文档**的未落库产物。
  **② P0-2 AR-12（修复）**：声明写 `(t0Open − min(Low[T+1..T+2])) / t0Open`（归一化回撤比例），而 `semanticProjection.ts#pickAggregated` 只返回 `Math.min(low)`（**绝对价格，恒 > 0**）⇒ `<= 0` 恒为假（**0 样本**）、`> 0` 恒为真（**全样本**）⇒ 以它作条件的 Finding **必产不出来**（`_probe_d_conditional_shape.out.json` 实测 `0` / `1718`、`DIFFERENCE=0`、`P=1`）；`pullback_shrink_ratio` 同族（比例 vs 绝对成交量）。**修法**：在 `shared/patternSemantics.ts` 加**受控归一化声明**（`normalization` = `DIFFERENCE`/`DIRECT` + `referenceField`/`divisorField`，字段**白名单** `SEMANTIC_BASELINE_FIELDS`），`ExpandedSemantic` 透传（**不新增第二套 Expander**），`semanticProjection.ts` 新增 `normalizeSemanticValue()` 按声明计算，并在声明了归一化时置 `needsEventBar: true`（否则基准不注入 ⇒ 变量静默全 null）；缺失 / 非有限 / 分母 ≤ 0 ⇒ `null`（不臆造、**不回落成绝对值**）。注册期新增 5 条拒绝（`DIFFERENCE` 缺基准 / `DIRECT` 又给基准 / `DIRECT` 无分母 / 基准不在白名单 / 非 `POST_BAR` 用归一化）。
  **③ P0-3 AR-13（修复）**：`ResearchConclusionDraft` 的 §15 五个字段（`researchQuestion`/`evidenceSummary`/`findingIds`/`limitations`/`nextQuestions`）**全是可选**，而 `conclusion.ts` 的**主判定分支** `draft` 只写 5 个基础字段就返回 ⇒ 五个字段全丢，`engine.ts:370` 的 `?? []` 兜底落库成 `NULL`/`[]`，**`tsc` 却 0 错**（真库 15 条结论：12 NULL + 3 `[]`、**无一非空**，且 `660001`/`660003` 所属 Run **各有 24 条 Finding** ⇒ 是活缺陷不是历史遗留）；**修法**：主分支补齐 §15 五件套、与 R1 分支**键集对齐**（修复点只能在草稿构造 —— 仓库层只是 `encodeJson(input.findingIds ?? null)`、引擎层只是 `?? []`，改那两处只会继续掩盖）。
  **④ P1-4 AR-14（接线）**：`patternLibrary/strategyProjection.ts` 全仓**只被自己的单测引用**（休眠模块）⇒「Research 与 Strategy 用同一份 `pat_*` semantic definition」**只在文件层面成立**；**修法**：新增 `server/research/patternLibrary/strategyConsumption.ts`（纯函数、零 IO、**不 import `strategyCore`**，注册表能力回调注入 ⇒ 不新增跨域依赖边）作为**执行侧消费点**，产出 `Pattern ID / Semantic Variable / Strategy Feature` 映射表并对表两条**可失败**判据（`FEATURE_NOT_REGISTERED` / `THRESHOLD_PARAM_NOT_DECLARED`）；接线于 `runWorkbenchAssembly/assemble.ts#assembleStrategySide`，结论并进**既有** `strategyDecisionEngineNote`（**零 schema 变更**，经 `researchRunRouter.ts:688` 透出）。
  **⑤ 真实 DB E2E（`docs/evidence/_e2e_9cc_closed_loop.mts`，走 `appRouter` 真实 tRPC）—— 24/24 PASS**：Dataset Version `390002` × 窗口 `2025-01-02..2025-02-28` × `decisionOffsetDays=2`；**AR-12**：`pat_pullback_hold_depth_2d <= 0` ⇒ CONDITION **1436**、`> 0` ⇒ **282**、ALL **1718**（修复前 `0`/`1718`）；**AR-13**：三个结论 `findingIdsJson` = `[450001]`/`[450002]`/`[450003]`，**与本 Run 真实 Finding 逐 id 相等、零孤儿零漏写**；**闭环一**：Run `1290003` → Finding `450003` → Conclusion `1170003` → 候选派生 `filterRule=[{bar.volumeRatio, <=, max_volume_ratio}]`（条件数 0→1）、`sourceFindingIds=[450003]` → promote `cand-1110001@1.0.0`（其**规则图引用 `max_volume_ratio`** ⇒ `9bt` 指出的缺口当场闭合）；**闭环二**：2 组合（`max_volume_ratio` **0.05 / 1**，声明全域两端）真实执行 16 s / 0 失败 ⇒ `tradeCount` **0 → 1**、`totalReturnPct` **0 → −0.6814%**、指纹 `dc5627dce6c7…` ≠ `0f02b2f64d0b…`；**§4b 实际消费**：直接调评估端口 ⇒ 请求的每个键在实际 `parameterSet` 里**逐键相等**、复核指纹与落库**逐位相同**、实际值**压过文档默认值 0.3**。
  **⑥ 验收**：`tsc --noEmit` = **0 错**；新增单测 **17（AR-12）+ 3（AR-13）+ 7（AR-14）**、改写 **+5** 例（AR-12 注册期拒绝，并把一条**把缺陷固化成契约**的旧断言按声明口径改正）；全量 `vitest run` = **7 失败文件 / 16 用例 —— 失败文件集合与基线逐个相同 ⇒ 零新增**（283 passed / 290）；`checkEolDrift --strict` = **0 漂移**；AR-13 断言做过**负例自测**（临时去牙 ⇒ 3 条变红 / exit 1，随后字节级复原）。
  **⑦ 边界**：**零 migration / 零新表 / 零新列 / 零新依赖 / 零新端点**；`client/**` 与 `scripts/**` 零改动；历史数据一律未改（`SELECT-first`）；E2E 自建自清（`purgedAfter={experiments:1, strategies:1}`、`finalExperimentCount=7`）。
  **⑧ 顺手按约定翻转一条失效哨兵**：`_e2e_d_evidence_bridge.mts` 原断言「上游仍不写 `findingIds`」已随 AR-13 修复失效（文件头原话即「修好后会变红，提醒撤销脚手架回填」）⇒ 改为**正向断言**并**移除脚手架回填**（保留回填反而会掩盖回归）。报告 = `docs/research/9cc-implementation.md`。

- **9cb. （PHASE-D-001 · Research Evidence → Candidate 确定性派生桥 · 事项 `rb1KTe`）** ✅ **已完成（2026-09-20）**：补上「**人必须把研究结论重新手写一遍成策略规则**」这条断链 —— 让 `createFromConclusion` 真正**消费 Finding 的证据内容**。**① 交付（零 migration / 零新表 / 零新列 / 零新依赖）**：`server/research/strategyCandidate/evidenceDerivation.ts`（**新**）= 派生器**唯一实现**（`deriveCandidateRules` / `buildSemanticIndex` / `computeDerivationFingerprint` / `buildDerivationSnapshot`，纯函数、不读时钟）；`service.ts` 新增装配函数 `deriveCandidateEvidence`（按 `conclusion.findingIds` 取 Finding → `primaryAnalysisId → research_analysis.moduleKey → findPatternByResearchModuleKey` 反查 Pattern → 预取 `research_analysis_condition` 结构化条件）并把 `createFromConclusion` 接线为「**`overrides` 优先、缺省用派生**」+ 补写 `sourceFindingIds` / `sourceHypothesisId` + 快照增 `derivation` 段 + 新增入参 `deriveFromEvidence`（缺省 true）；`client/src/components/research/RuleDerivationCard.tsx`（**新**）= D.9 的 human review gate（研究侧原文 → 策略侧条件 → 来源 Finding / 未翻译登记 / 方向警告，`readDerivation` 导出以便纯逻辑测试）；`strategyCandidateAdapter.ts` 增 `sourceTraceJson?: unknown`；`StrategyCandidateDetail.tsx` 挂载该卡；测试 `evidenceDerivation.test.ts` **19 例** + `ruleDerivationCard.test.ts` **5 例**。**② 三条硬纪律**：⒜ **只用结构化条件**（权威 = `research_analysis_condition`，不是 `dimensionJson.conditionRule` 字符串 —— 解析字符串等于凭空发明文法）；⒝ **不可翻译 ⇒ 如实登记绝不猜**（5 类 `skipped`：无结构化条件 / 非语义变量 / 无执行侧投影 / 含 OR 语义 / 阈值参数未声明）；⒞ **方向差异「派生 + 登记」**—— 研究侧条件与执行侧门槛是**两个层面**（真库 `pat_pullback_hold_depth_2d >= 0` 表达「存在性」、`bar.haircutFromEventLow <= max_drawdown` 表达「幅度上限」），硬要求方向一致会**误杀全部合法条件** ⇒ 翻译照做（执行侧以声明为准），差异以 `directionMismatch` + `directionNote` 摆到人眼前。**③ D.5 provenance 全部落进既有载体（零 migration）**：`sourceFindingIdsJson` 列**早已存在却从不被 `createFromConclusion` 写**（本轮补写）；`sourceAnalysisIds` / `patternId` / `derivationVersion`（`research-evidence-derivation@1.0.0`）落 `sourceTraceJson.derivation`；`patternId` **只记真正被引用的那个 Pattern**。**④ 验收**：`tsc --noEmit` = **0 错 / exit 0**；新增 **24 例**全过；全量 `vitest run` 失败集合与基线**逐个相同**（零新增失败）；`checkEolDrift --strict` = 0 漂移。**⑤ 真实 DB 端到端（`docs/evidence/_e2e_d_evidence_bridge.mts`，走 `appRouter` 真实 tRPC，13/13 PASS）**：实验 `decisionOffsetDays=2` → Run `1200002` `COMPLETED`（14.4 s）→ Finding `360002`（`EFFECT`）→ Conclusion `1080002` → **候选 `1020003` 派生 `filterRule = [{bar.haircutFromEventLow, <=, max_drawdown}]`**（条件数 **0 → 1**）、`sourceFindingIds=[360002]`、`skipped=1`（内建 `pullback_holds_event_open_2d`）、`directionMismatchCount=1`、`patternIds=[first-limit-pullback-hold-shrink]` → **`ACCEPTED → promote` 成功**：`strategyId=cand-1020003` / `strategyVersion=1.0.0` / `strategyVersionId=870001` / provenance `origin=DIRECT`；**对照**：同一结论 `deriveFromEvidence:false` ⇒ `filterRule=null` 且无 `derivation` 段（**零回归硬证据**）。自建自清。**⑥ 🔴 三个上游缺陷（如实登记、不在本阶段修）**：⒜ **`pat_*` 语义变量无区分度（PHASE-B-001 遗留）** —— 实测 `pat_pullback_hold_depth_2d <= 0` 命中 **0** 个样本、`> 0` 命中**全部 1718**（DIFFERENCE=0），而内建对照 `pullback_holds_event_open_2d == 1` 命中 1436 / P=0.0005 / 产出 Finding；根因已定位到**声明侧**：`patterns/firstLimitPullbackHoldShrink.ts` 的 `definition` 写的是 `(t0Open − min(Low[T+1..T+2])) / t0Open`（**归一化回撤比例**），而语义投影只按 `field:"low" + aggregation:"MIN"` 取值 ⇒ 实际返回**最低价绝对值**（恒 > 0）—— 「**声明说 A、实现算 B**」的静默失效，修它要动 `shared/patternSemantics.ts` 的表达力（架构变更）；⒝ **结论不写 `findingIds`（Finding/Conclusion 域）** —— Run 已产出 Finding 且 `detection.status=OK`，结论 `findingIds` 仍为空数组（真库 15 条结论里 12 条 NULL、3 条空数组）⇒ 任务书 D.1 的「Conclusion 保存了 Findings」**在列上不成立**（只在 `evidenceJson.findings` 里）；E2E 为此加**显式标注的脚手架回填** + 一条**哨兵断言**（上游修好后会变红，提醒撤销脚手架）；⒞ 手工建 analysis 不给 `moduleKey` ⇒ Pattern 反查失败 ⇒ 参数空间为空 ⇒ 语义条件被登记为 `THRESHOLD_PARAM_NOT_DECLARED`（探针坑，已写进注释）。**⑦ 未做**：`recommendedThreshold` 类「从证据推断阈值数值」**刻意不做**（D.3 禁黑箱拟合；派生只产**参数引用**）；幂等去重仍按「同结论 + 同名」（改它需先裁定与「允许不同名多份候选」的冲突）；`researchPlannerRouter` 的 `patternId` 路径仍写空 `filterRule`（统一两条路径属独立小项）；未新增任何 tRPC 端点；**未做**「带 derivation 的真实候选 + 无头浏览器量 DOM」（E2E 自建自清，库里没留样本）。**⑧ Phase C = DEFERRED**（未出现「≥2 个 Pattern 需要新 Analysis Type」的情形，不提前执行）。报告 = `docs/research/PHASE-D-001-implementation.md`；证据 = `docs/evidence/_e2e_d_evidence_bridge.out.json` / `_probe_d_evidence_shape.out.json` / `_probe_d_conditional_shape.out.json` / `_probe_d_finding_config.out.json`。
- **9ca. （PHASE-B-001 · Pattern Semantic Slot · 事项 `riwPtR`）** ✅ **已完成（2026-09-20）**：解决 `FEATURE_VARIABLES` / `assertConditionFieldsKnown` 封闭导致「加一个新语义要改五处」的扩展瓶颈 —— 让 Pattern 只声明**受控语义**，由系统统一展开到 Research 与 Strategy。**① 交付（8 文件，零 migration / 零新表 / 零新列 / 零新依赖）**：`shared/patternSemantics.ts`（新，零依赖纯函数）= 语义词汇 + **operator 白名单 16 项** + 声明类型 + 校验器 + **唯一 Expander** `expandPatternSemantics()`；`server/research/patternLibrary/semanticRegistry.ts`（新）= **唯一 SoT 注册表**（`patternId+version` 唯一、`semanticId` 全局唯一、产物**深冻结**、问题在**注册期**响亮抛 `PatternSemanticsError`）；`server/researchEngine/semanticProjection.ts`（新）= Research 投影（声明 → 观察日变量定义，含自己的 `resolve`）+ 两道可用性闸门；`server/research/patternLibrary/strategyProjection.ts`（新）= Strategy 投影（→ 特征 + 比较方向 + 阈值参数名）；`patternLibrary/types.ts` 增 `semantics?`；`patterns/firstLimitPullbackHoldShrink.ts` 声明 **2 条语义**；`researchEngine/variables.ts` 增**语义注入点**（`hasObservation` / `observationOffsetOf` / `listObservations` / `resolveObservation` 四处，未声明名字仍被 `UNKNOWN_VARIABLE` 拒）；`engine.ts#buildCatalog` 注入。**② 关键设计**：两侧投影**只吃** Expander 的同一份产物 ⇒ 物理上不可能双写 Semantic SoT；`POST_BAR` 的 `availableFromOffset` **必须等于** `windowDays`（声称更早可见即 look-ahead ⇒ 注册期拒绝）；返回来源（`PATH_ROW`/`OUTCOME`）**两侧都禁止**当条件；只声明研究意图而无执行侧投影 ⇒ `MISSING_STRATEGY_PROJECTION`（不臆造执行口径）。**③ 🔴 两处更正上一轮的判断（诚实留档）**：⒜ **`legacy-recipe` 回落不是静默的** —— 字段注释（`assemble.ts:273`）与两条回落分支（`:707` / `:747`）都写入**带原因**的 `strategyDecisionEngineNote`，并经 `:768-770`、`:974` 返回、由 `researchRunRouter.ts:687-688` **透出** ⇒ B.10 当前实现**已满足**，本阶段只做核实、不改代码（先前「静默回落确实存在」的判断**作废**）；⒝ `samePointAvailability`（`recipeRegistryAtoms.ts:47-60`）的日期恒为 `1990-01-01` 是**声明式设计的必然结果**（表达「只读决策日当根」，逐行 PIT 由数据集 `asOf === tradeDate` 与 `decisionBarOf(bars)` 保证），**不是漏洞但也不是约束** ⇒ 本阶段把 Pattern 语义投影的可用性换成**真实决策日**，并在**投影期**加「`availableFromOffset ≤ 决策日偏移`」这条**可失败**闸门（`AFTER_DECISION_DAY`）；`samePointAvailability` 保留给既有特征不改。**④ 验收**：`tsc --noEmit` = **0 错 / exit 0**；新增测试 `tests/server/research/patternLibrary/patternSemantics.test.ts` **26 / 26**（正向 / 负向 8 类拒绝 / 唯一性与不可变 / 两侧投影与一致性 / **PIT 与两条可失败对照**）；全量 `vitest run` = **7 失败文件 / 16 用例（286 文件 → 7 failed / 279 passed；4847 / 4863）**，失败集合与基线**逐个相同**（全为环境依赖）⇒ **零新增失败**；R1 的 `observationDecisionDay.test.ts` **12 / 12 继续全过**（B 未放行 R1 护栏）；`checkEolDrift --strict` = **0 漂移**。注册表实跑：1 条目 `first-limit-pullback-hold-shrink@1.0.0`（fingerprint `356cfe56d447…`）⇒ 展开 `pat_pullback_hold_depth_2d` / `pat_pullback_shrink_ratio_2d`（均 `OBSERVATION`、offset 2、带 `haircutFromEventLow` / `volumeRatio` 投影）。**⑤ 未完成（合并前补）**：⒜ **真实 DB 的 Research Run E2E**（条件引用 `pat_pullback_hold_depth_2d` 的 CONDITIONAL Run）—— 本轮做到**机制级 E2E**（真实注册表 + 两侧投影 + 逐项一致性 + PIT 正负向，全部有测试），真实 DB 段未跑；⒝ B.12 链路里 `→ Candidate` 属 Phase D（`9cb`），本阶段不实现。报告 = `docs/research/PHASE-B-001-implementation.md`。
- **9bz. （PHASE-R1-001 · 首板回踩 Sample Selection / Look-ahead 修复 · 事项 `rH3f0u`）** ✅ **已完成（2026-09-20）**：消除「若研究在 `T+d` 判定、却用整段 `T+1..T+N` 的未来数据决定样本是否进池」的 survivor / look-ahead bias。**① 两条互相独立的真缺陷（第二条任务书未提，审计发现）**：⒜ 数据集层 `server/researchDataset/pullback.ts#screenSingleTarget`(:116-126) 遍历 `buildWindowBars`(:190-205) 生成的**整段** T+1..T+N 判 `broken`/`hitLow`，`#screenFirstBoardRow`(:286-298) 的 `windowComplete` 还要求 N 根齐备；⒝ 研究层 `server/researchEngine/engine.ts#assertGroupPitSafe`(:1032-1043) 取 `evaluationOffset = max(组内观察日变量的 offset)` 再断言「每个 offset ≤ 该 max」——**循环定义、恒真、生产路径永不触发**，而它正是 `variables.ts#assertObservationConditionsPitSafe`(:1495-1515) 自称的「整个 OBSERVATION 角色存在的**唯一防线**」（那句注释担心的「用 T+5 的形态筛 T+3 该买的样本」就是修复前的实际行为）。**② 关键设计发现（把修复面大幅缩小）**：观察日变量**按名字自带窗口**（`pullback_{stat}_{k}d` ⇒ `availableFromOffset=k`、只读 `1..k`），且加载侧本就按引用收窄（`sampleSet.ts:179` → `datasetFromRegistry.ts:1042`）⇒ **只要护栏是真的**，每个被引用的观察值窗口自然 ⊆ `T+1..T+d`，**无需给 `ObservationSources` 加 `asOfOffset`、无需改任何 resolver**。**③ 交付（14 文件，零 migration / 零新表 / 零新列）**：契约 `shared/researchContracts.ts` 增 `decisionOffsetDays`（**必填、刻意无 default**）；`researchDataset/{types,pullback,validate,builder}.ts`（新增唯一实现 `resolveDecisionOffsetDays()`，非法即 throw；判定改 `decisionBars = loadedBars.slice(0, d)`；落 `pullbackDecisionOffsetDays` 随版本冻结）；`researchEngine/{types,datasetReader,variables,engine}.ts`（**新增唯一护栏实现** `assertGroupObservationPitSafe()` + 判定日解析 `resolveEffectiveDecisionOffset()`；**删掉恒真的私有 `assertGroupPitSafe`**）；3 个新错误码 `OBSERVATION_WITHOUT_DECISION_DAY` / `INVALID_DECISION_OFFSET` / `DECISION_OFFSET_CONFLICT`；路由 → `BAD_REQUEST`；客户端 3 条诊断文案；回填脚本与测试夹具同步。**④ 🔴 判定日载体（用户裁定，本轮最关键的架构决定）**：初版只放数据集层，E2E 立刻暴露**结构性阻塞** —— 引擎读的是 registry 的 `dataset_version`，而 STEP 12.6 的 `research_dataset` 表**在 `server/researchDataset/` 之外零引用**（引擎从不读它），且 registry `createVersion` 写入的 `universeDefinition`/`filterDefinition` **都不含决策日、该路径也没有回踩筛选** ⇒ `decisionOffsetDays` 恒为 `null` ⇒ 现有数据集上**一切观察日条件都会被拒绝**（含 pattern `firstLimitPullbackHoldShrink` 的核心条件）⇒ 研究链被阻塞。**用户裁定：判定日下沉为 Run / 分析级声明**（理由：registry 数据集的「池子」= 首板事件本身、无筛选，决策日只是「本研究在 T+d 判定」的分析意图，语义上不属于数据集）。现实现为「**分析 → Run → Experiment → Dataset** 四级取**唯一值**」：多处异值 ⇒ `DECISION_OFFSET_CONFLICT`（比缺声明更危险：同一份样本被两套信息边界解释）；四级全空 ⇒ 引用观察日变量一律拒绝，**绝不退回「整窗可判定」这种恒真的假护栏**。**⑤ 验收（全绿）**：`tsc --noEmit` = **0 错 / exit 0**；新增单测 **pullback 14/14 + observationDecisionDay 12/12**（含两条**反证**断言：旧口径必然放行、同数据在整窗口径下结论不同）；全量 `vitest run` = **7 失败文件 / 16 用例（285 文件 → 7 failed / 278 passed）**，失败集合与基线**逐个相同**（全为环境依赖）⇒ **零新增失败**；`checkEolDrift --strict` = **0 漂移**；**真实数据池对照**（同窗口/同目标位/同容差，唯一变量 = 决策日；`d=N` 与修复前整窗语义**逐字等价**）⇒ 修复前 `d=5` 入池 **52** 行（NOT_MATCHED 333 / INCOMPLETE 3）、修复后 `d=2` 入池 **70** 行（317 / 1）⇒ **旧池子把 18 只「未来 5 天内会跌破」的样本预先踢出**（+34.6%，survivor bias 的直接度量）；**真实 DB 五路端到端 E2E**（`docs/evidence/_e2e_r1_decision_day.mts`，数据集 `390002`、窗口 `2025-01-02..2025-02-28`，带**对照**设计）：无声明 + 观察日条件 ⇒ 预检拒绝 `OBSERVATION_WITHOUT_DECISION_DAY`（`FAILED`、**`startedAt=null`**、无半成品）；同实验换纯特征条件 ⇒ `COMPLETED` 1720 样本 / 16 结果 / `conclusionId 870001`；**实验声明 `d=2` + 观察日 offset=2 ⇒ `COMPLETED`（1720 / 16 / `conclusionId 870002`）**；同实验 offset=3 ⇒ `VARIABLE_ROLE_VIOLATION`；`run.config` 与实验异值 ⇒ `DECISION_OFFSET_CONFLICT` ⇒ 拒绝原因唯一地钉在「观察日变量的信息边界」上。自建自清（`purgedAfter=2`）。**⑥ 副产品（推翻上一轮结论）**：Run#2 真实触发 `emitReportArtifact` 钩子（产出 `artifact=#60001`）⇒ PHASE-A 复核遗留⒝「钩子从未被观测到触发」**不成立**，已改判。**⑦ 未做（如实登记）**：⒜ STEP 12.6 的 `research_dataset` 与引擎**未合流** —— 引擎只读 registry 版本，故「数据集层截断」当前只对构建链路生效；⒝ 老版本 `390001`/`390002` 仍是未做回踩筛选的首板事件池，要按 d 筛选需新建版本；⒞ 全仓仍存在**数据集层与研究层各写一份窗口实现**的重复，以及 `ConditionGroupsEditor.tsx` 对变量名正则的 UI 镜像（未动）；⒟ 研究域三套 E2E（OOS/WALK-FORWARD/robustness）与本次改动无交集，未复跑。报告 = `docs/research/PHASE-R1-001-implementation.md`；证据 = `docs/evidence/_e2e_r1_decision_day.{mts,out.json}`（已登记 `docs/evidence/README.md`）。
- **9by. （PHASE-A-001 · Research Report Artifact 最小闭环 · 事项 `rCsha3`）** ✅ **已完成（2026-09-20 独立复核）**：把 Research 已产出的 `Result→Finding→Conclusion` 沉淀为**可持久化/可追溯/可重新查看**的 `research_artifact(REPORT)`。**① 交付**（另一会话 2026-09-19 22:48 提交 `0e90fc1`）：`server/researchEngine/report/**`（`generator.ts` 纯投影层 782 行 + `service.ts` 装配/幂等 + `types.ts`/`index.ts`）+ 生命周期钩子 `engine.ts:400 emitReportArtifact()`（在 Finding:340 → Conclusion:345 → Run COMPLETED 之后，best-effort）+ 只读端点 `researchEngine.getReport` + 前端 `client/src/pages/research/ReportView.tsx` 与 `ResearchDetail` 入口+ 回填 CLI `scripts/generateResearchReport.mts` + `tests/server/researchEngine/reportGenerator.test.ts`（10 例）。**② 独立复核（本条目，三探针实跑）**：全库 artifact **仅 `REPORT/INLINE ×15`**；15 个 COMPLETED Run **各恰好 1 份** REPORT（`completedRunsWithoutReport = 0`）、每 Run checksum 唯一；样本 Run `750003` ⇒ artifact `#30001`（`metadataJson` 274,368 字符，`datasetVersionId=390002`、`conclusionId=660003`、28 analysisIds / 24 findingIds、`report.bytes=336830`、checksum `ac31f742…`）；前端真实 Chrome + CDP：`/research/480003` 渲染出入口（`href=/research/report/750003`）→ 点击**真实导航** → 正文 **242,481 字符**、7 章节齐全、原文视图 258,105 字符，反例 `/research/report/1` 显示「研究报告加载失败 / RPC_ERROR / 未找到…」且**无**正文。**③ A-2 结构性判据（静态核对，未做写入型复跑）**：`checksum` = sha256 over **report body utf8**（`REPORT_CHECKSUM_SCOPE = "report-body-utf8"`），`generator.ts` **不读时钟**（全文无 `generatedAt`；「报告生成时间」取 `artifact.createdAt`，见 `ReportView.tsx:175`）⇒ 同内容必同 checksum ⇒ `service.ts:227` 的 `REUSED`（同 run 已有同 checksum ⇒ 零写入复用）成立。**④ 🔴 复核抓到一次「原报告绿 ⇒ 实测红」（环境级，非产品缺陷，已修）**：首跑 A-4 **FAIL**（入口可见、正文不渲染）；CDP 抓到 `Invalid hook call` + `TypeError: Cannot read properties of null (reading 'useId')`（`chunk-HLYKEPLF.js:929` ← `streamdown.js?v=42114ff8` ← `react-dom_client.js?v=805c5030`）。**有据的根因**：3000 端口 dev server 进程 **23:06:16** 启动，**早于** 23:10 由另一 vite 实例（5199）执行的「清空 `node_modules/.vite/deps` 后重建」⇒ 同一页面出现**两个不同的 `?v=` 哈希、且都不等于当前 `browserHash=70c3c53b`**，模块图不一致使 React 渲染器与 Streamdown 落到**两个不同的 React 模块实例**；已**排除**「装了两份 React」（全 deps 仅 `chunk-HLYKEPLF.js` 内联 `react.development.js`，`react-dom` 经它 `require_react`）；**后端正常**（`researchEngine.getReport` = 200 且载荷完整）；`ReportView.tsx` 自 `0e90fc1` 起**零改动**。**修法 = 重启该 dev server**（已获用户授权；在途 Run 实测 = 0，仅僵死的 `research_question:270001` 与「从未执行」草稿 `630002`）⇒ 复跑 A-4 **`ok=true` 全绿**。**⑤ 验收（8 项全部通过）**：A-1 / A-2 / A-3 / A-4 / A-7 / A-8 **独立复核通过**；**A-5 本次转绿** —— `tsc --noEmit` 实测 **exit 0 / 0 字节输出**（原 23 条 parameterSearch·searchRobustness 遗留已被并行会话清零 ⇒ 原报告「A-5 未达字面 exit 0」**失效**）；A-6 **独立复跑通过** —— `vitest run` = **7 失败文件 / 16 失败用例（284 文件 → 7 failed / 277 passed）**，失败集合**全为环境依赖**（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`）⇒ **零新增失败**，且旧基线里的已知失效 `parameterSearchEffectiveness` **已不再失败**（较旧基线 8 文件 / 17 用例**各减 1**）；新增 `reportGenerator.test.ts` **10 / 10 通过**。**⑥ 边界**：零 migration / 零新表 / 零新列（`git show --stat 0e90fc1 -- drizzle/ server/db.ts` 为空）；`checkEolDrift.mjs --strict` = **0 漂移**；未新建第二套 Result / Finding / Conclusion / Artifact / Repository。**⑦ 遗留（如实登记）**：⒜ `research_artifact` **无唯一约束**，幂等只靠服务层自查 ⇒ 并发回填同一 Run 是否双写**未实测**（加唯一索引属 migration，需单列小项）；⒝ 生命周期钩子 `emitReportArtifact` **在真实 Run 上从未被观测到触发**（实测 `completedAfterBackfill = 0`；15 份产物 `createdAt` 全为 2026-09-19 13:59~14:05 = 回填批量产物，而 15 个 Run 的 `completedAt` 均在 09-11~09-16）⇒ 「Run 收尾自动出报告」这条边**目前只有代码、无运行证据**；⒞ 13/15 份产物的 `metadataJson.patternId = null` 且 `unresolvedTraceFields = ["patternId（分析的 moduleKey 未能反查到模式声明）"]`（仅 750003 / 750001 有 `patternIds` 数组）⇒ **Pattern 反查桥薄弱，与 Phase B / D 直接相关**；⒟ artifact `#30011` 正文 **1,378,137 字节** 以 INLINE 存 longtext ⇒ 载荷规模值得留意。**⑧ 编号**：PHASE-A-001 原拟 `9bx` 已被 HOMEPAGE-007 占用 ⇒ 本条按台账取 **`9by`**；**后继 R1 / B / D 顺移为 `9bz` / `9ca` / `9cb`**（R1 事项正文所写「拟用 9by」需同步改）。报告 = `docs/research/PHASE-A-REPORT-ARTIFACT-001.md`；本轮回核证据 = `docs/evidence/_report_frontend/`（A-4 复跑刷新）+ 仓外 `_scratch/` 一次性探针。
- **9bx. （HOMEPAGE-007 · 连板梯队组内行序：兜底桶「其他」压尾 · 用户口述）** ✅ **已完成（2026-09-19）**：用户原话「首页连板梯队里每个高度内排序，把“其他”题材放到最后」+「每个高度内排序不是按格子高度内题材热度排序，而是按当日所有涨停题材热度排序」。**① 口径判读（后者 = 既有口径，本轮把它证成）**：组内排序键 = `limitUp.getSectorDistribution` 的**当日全市场**题材涨停家数（`server/db.ts#getDailySectorDistribution` 对当日全部 `limit_up_records` 按 `normalizeSectorName` 聚合），**不是**「本组内该题材出现几次」—— 探针新增「口径取证」断言把它钉死：`6 板` 行的「PCB」**当日热度 2 > 本组出现 1 次**（若按组内计数则二者恒等）；且每个高度组都新增「压尾」断言、非「其他」段断言「热度单调不增」。**② 本轮交付的新规则**：`shared/sectorHeatOrder.ts`（唯一实现）新增 `TAIL_SECTORS = ["其他"]` + `isTailSector()`，比较器把压尾档放在**热度比较之前** ⇒ 「其他」不参与热度名次、恒在组内最后；压尾档**内部**仍按热度 → 封板时间 → 代码排。**为什么必须单列一档**：`normalizeSectorName` 的缺省值就是「其他」（代表**无题材归属**），但它家数往往很多 —— 实测 `2026-09-18`「其他」当日 **10 家 = 全市场最高**（次高半导体 7），纯按热度排会把兜底桶顶到组内最前。**③ 验收（四层）**：`tsc --noEmit` = **0 error**；`tests/shared/sectorHeatOrder.test.ts` **7/7**（原 4 例 + 新增 3 例：热度最高仍压尾 / 缺当日数据仍压尾 / `isTailSector` 只认兜底桶本身不做前缀匹配）；`pnpm run docs:tests` 镜像重跑（`shared` 模块 132 → 135 用例）；`node scripts/checkEolDrift.mjs` = **0 漂移**；**无头 Chrome + CDP 探针**（新增 `docs/evidence/_probe_ladder_tail_sector.mjs`）对 3 个日期逐组断言 = **PASS 29 / FAIL 0**，**A/B 负例对照**（临时停用压尾分支后重跑）= **PASS 14 / FAIL 6 / exit 1**，`2026-09-02` 的 4 个高度组里「其他」**全部位于首位** ⇒ 断言可失败（侧车 + md5 `3c2f2c1d…` 逐字节复原）。**④ 边界**：纯 `client/**` + `shared/**` + `tests/**` + 文档 ⇒ **零 `server/**` 改动**（`grep` 实证 `shared/sectorHeatOrder.ts` 在服务端**无任何消费者**，只被 `Dashboard.tsx` 与单测引用）⇒ 不触发热重启、不杀在途 Run；零迁移 / 零新表 / 零新依赖 / 零新端点；未改库内数据。**⑤ 遗留（如实登记）**：`docs/testing/**` 是**整仓生成物**，本轮重跑同时带出**他人已提交但未同步**的 3 个模块镜像（`tests/` 实为 284 文件 / 4751 用例，镜像此前停在 277 / 4530）⇒ 一并保留 —— 只保留 `shared` 会与 `README.md` 的总览表数字互相矛盾。**⑥ 探针自身踩到的坑（已修）**：等「日期已切换」**不能用 `card.innerText.includes(date)`**（`<select>` 的 `innerText` 含全部选项文本 ⇒ 立刻通过、量到上一个日期的旧 DOM），必须绑到「板数窗口：… ~ <date>」那段 `<span>`。详见 `docs/evidence/README.md` `laddertailorder` 节。
🔁 **同日追加修订（用户澄清 ②③）**：用户指出「相同热度的题材，排序和下面的题材热力图排序不同，导致对不上」⇒ 确认为**真缺陷**（两处**次级键**不同：梯队用「封板时间」、热力图用「窗口合计 → 题材名」）。修法 = `shared/sectorHeatOrder.ts` 抽出 `compareSectorOrder`（**① 非压尾档在前 → ② 当日家数降序 → ③ 窗口合计降序 → ④ 题材名升序**）作为**唯一题材次序**，梯队与热力图都只调它；梯队的「封板时间 → 代码」降为 `tieBreak`、**仅在同一题材内部**生效（同一题材的格子仍挨在一起、组内仍按封板时间升序）；`buildSectorHeatLookup(days, date)` 由「单日」改为「窗口逐日 + 所选日期」，一次扫描同时产出两个键。**取证**：探针新增 ⒟ 同热度次键、⒠ 与热力图同序两条断言（**仅在「梯队所选日期 == 热力图最新列」时比行序** —— 否则是假 FAIL，实测确实先误报过 `2026-09-16` 的 3 条并已收窄）；**改后 32 PASS / 0 FAIL（3 个日期）**；**改前（HEAD 版本）同一探针 14 PASS / 8 FAIL / exit 1**，其中默认日 `2026-09-18` 的三条正是用户症状：`2 板` 的「其他」在第 1~5 格、`首板` 的「其他」在第 1~8 格、`同热度(5) 外贸出口(合计5) 却在 光通信(合计69) 之前`（热力图侧 光通信 #5 / 外贸出口 #7）。单测 7 → **10** 例（新增「次键 = 窗口合计降序」「末键 = 题材名升序」「tieBreak 不把不同题材交错开」「🔴 回归：梯队去重后 == 热力图行序」）；`docs:tests` 镜像重跑（4754 用例）。
- **9bw. （WALK-FORWARD-001 · Walk-Forward 验证完整闭环）** ✅ **已完成（2026-09-19）**：新增 `server/research/walkForward/**`（11 文件 + `shared/walkForwardContracts.ts` + 两表 + 前端面板 + 6 端点 / 零新 router）—— 全仓**第三条并列执行边**（编排层，不是新引擎）。**与两域构成三方向镜像守卫**：`searchRobustness/**` = import **黑名单 + 零重跑**（只在冻结快照上做邻域统计）｜`oosValidation/**` = **必含清单 + 必须重跑 + 必须重算**｜本域 = **黑名单 +「执行只能经由注入钩子」**（`WalkForwardExecutionHooks{readCurrentContext, runFoldSearch, runFoldOos}` 由组合根 `paramSearchRouter` 用**既有** PS / OOS application service 实现 ⇒ 零复制策略 IO、零 HTTP 自调用，规格 §15 明禁的 `WalkForward → HTTP → OOS API → HTTP → Backtest` **不成立**）⇒ **三套守卫互不可搬移**。**窗口契约**：`ROLLING`/`EXPANDING`；四个几何量单位 = **交易日个数**；硬约束 `isEnd < oosStart` 且 `oosStart = isEnd + 1 trading day`；切窗**复用**既有 `generateWalkForwardSplits`（**不重写算法**）。**Fold 六态生命周期** + 非法迁移响亮拒绝 + `FAILED`。**Leakage Guard**：`SearchEnd <= ISEnd` / `ISEnd < OOSStart` / `OOSEnd <= DatasetAvailableEnd` / 搜索日期非空且在 IS 内 / **明禁「先跑整个 Parameter Search 再把结果切成多 OOS Fold」**⇒ `WALK_FORWARD_SEARCH_NOT_INDEPENDENT`。**候选冻结**：只认「源 Search Run + `parameterHash`」，参数值由服务端从**源组合行**读出并**重算 `computeParameterHash` 复核**；冻结信息不足 ⇒ **显式失败**，**禁**静默回读**当前**策略版本补全；DB 读取**必须明确排序**（`WALK_FORWARD_COMBINATION_ORDER_UNSTABLE`）。**显式 Candidate Selection Policy**（`FIRST_ELIGIBLE_COMBINATION` / `EXPLICIT_PARAMETER_HASH`）；**不产出**最佳 / 推荐 / 最优 Fold。**多 Fold 汇总只做描述性统计**（键里无 `best/worst/rank`；生命周期计数与结果计数**各按自己的字段**核对；可用 Fold 为 0 时六项全 `null` 且 `availableCount = 0`，**不退化成 0**）。两表 `walk_forward_run` **33 列** / `walk_forward_fold` **36 列**（**0 FK / 0 DML / 0 ALTER**，手工幂等 SQL `0044_walk_forward.sql` + `scripts/applyWalkForward.mjs` 三模式）。前端 Run List + Run Detail + **窗口排程（创建时冻结）** + **Fold 矩阵（按序号升序 · 不排序不评级）** + Fold 详情 + 描述性汇总 + **深链 `?walkForwardRunId=…&foldIndex=…`（连 Fold 选中一起还原）**。**验收（五件套 + 三层证据全绿）**：`tsc` = 0；新增单测 **84/84**（域 48 + 静态边界 36）；全量 vitest **8 failed files / 17 failed tests = 基线，零新增**（283 文件 / 4805 用例）；`npm run build` = exit 0；`checkEolDrift` **0 漂移**；真实 TiDB E2E `create` **7/7** + `run` **10/10**（193 s，2 folds，`2025-01-02..2025-06-30`，`IS 40 / OOS 25 / step 25`）+ **跨进程** `rerun` **11/11**（新判据 W15：换进程 ⇒ `executed=false`、零新增行）+ `clean` 归零；DOM 探针 **`pass=true`**、0 page error。🔴 **杀掉的真实产品缺陷（1 个）**：`createWalkForwardValidationInputSchema` 的 `parameterSearchSpace` 是**被接受但从未生效**的死旋钮（全仓只被 PS 端点与契约声明引用）⇒ 从契约删除 + 新增「无死旋钮」守卫防再犯。⚠️ **已登记 Known Risk**：全仓库 11 个既有策略版本的 `ruleGraphRefs` 全为空 ⇒ 搜历史候选**必被拒**（`PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`），要真搜参数必须自建含参数引用的新版本（E2E 已演示）；`cand-360001@1.0.0` 的 3 个 TUNABLE 笛卡尔积 **1240 > 256** ⇒ `MAX_COMBINATIONS_EXCEEDED`（**禁截断**）。报告 = `docs/research/WALK-FORWARD-001-implementation.md`。
- **9bv. （OOS-001 · Out-of-Sample Validation 完整实现）** ✅ **已完成（2026-09-19）**：新增 `server/research/oosValidation/**`（10 文件）—— 全仓**第一条「消费搜索结果且必须重跑回测」**的执行边，与 `searchRobustness/**`（零重跑）**并列且语义相反**，两者守卫**镜像**（**黑名单** vs **必含清单**）⇒ 不可互相搬移。**参数冻结**（只认源 Search Run + `parameterHash`，**重算哈希复核**；冻结信息不足即**显式失败**，禁静默回读当前策略版本）·**接口层无参数值位置**（创建入参仅 4 键；DOM 实测创建区 `<input>` 恰 4 个）·**窗口隔离**（`OOS_WINDOW_OVERLAP` / `OOS_SEARCH_WINDOW_INVALID` / `OOS_WINDOW_OUT_OF_DATASET_RANGE`）·**五态状态机**（`COMPLETED` 不可再执行；重复 `start` 幂等 `executed=false`）·**真重跑**（复用唯一权威 `createStrategyBacktestBridge`）+ **真重算**（`projectCanonicalMetrics`）·**IS/OOS 六项逐项对照 + 三项派生**（**不产出「好 / 坏」结论**）。两表 32/41 列（0 FK、0 DML、0 ALTER、幂等 SQL `0043` + apply 脚本）+ **同域扩 6 端点**（零新 router，create 与 start 分开）+ 前端面板（深链 `?oosRunId=`）。验收：真实 E2E 阶段一 **2/2**、阶段二 **12/12**、跨进程二次重跑 **12/12**；新增单测 **65/65**；全量 vitest 失败文件集合 **8→8 零新增**；`vite build` 成功；`checkEolDrift` **0 漂移**；migration 首跑 2 executed / 次跑 0 executed + 2 skipped。⚠️ 已登记 Known Risk：`averageWin` / `averageLoss` **两侧都拿不到** ⇒ 如实留 `null`、**不补值**。报告 = `docs/research/OOS-001-implementation.md`。
- **9bu. （ROBUSTNESS-001 · Parameter Search 结果稳健性分析完整实现）** ✅ **已完成（2026-09-19）**：新增并列兄弟域 `server/research/searchRobustness/**`（**零重跑**：只读 `parameter_search_*` 冻结结果，结构性拿不到回测 / 评估端口 —— 静态守卫测试钉住）。**稳定性**（双容差 + `stabilityRatio`，口径持久化到 Run）、**敏感性**（数值给相对变化、枚举只给离散）、**邻域离散度**（六指标，复用 `shared/quant-stats`）、**二维稳定性矩阵**（缺格 `MISSING`、多命中 `AMBIGUOUS`，不补值）、**Validity Gate**（未完成 / 无结果 / 非 canonical / 串线四条领域码）、**`tradeCount=0` → `INSUFFICIENT_TRADING_ACTIVITY`**、**参数引用状态继承**（§12，附真实历史数据证明）。三表 33/28/16 列（0 FK、幂等 SQL `0042` + apply 脚本）+ `parameter_search_run` 补两列 + **同域扩 6 端点**（零新 router）+ 前端面板（含深链 `?robRunId=`）。验收：真实 2×2 E2E **42/42 PASS**（A~G 七条判据）、§12 真实历史数据 **9/9 PASS**、新增单测 **59/59**、全量 vitest 失败文件集合 **8→8 零新增**、`vite build` 成功、`checkEolDrift` **0 漂移**。⚠️ E2E 抓到一个真实缺陷并已修：基组合不可判时邻域被提前返回为空 + `stabilityRatio` 被算成 0（已加回归测试）。报告 = `docs/robustness/ROBUSTNESS-001-REPORT.md`。
- **9bt. （PARAMETER-002 · Parameter Search 有效性 Gate 与 Robustness 前置验收）** ✅ **已完成（2026-09-19）**：**N-02 定性 = 情况 D（参数未被消费），根因在策略文档不在 PS** —— 真实证据：声明 3 个参数而 Core **规则图引用 0 个**，三组隔离 A/B 权益曲线**逐字节相同**；**正对照**（条件改成参数引用）在同窗口给出 0.05 → **0 笔** / 1.0 → **8 笔 −10.36%** ⇒ 执行链本身正确。**修复**：`createSearch` 新增死参数筛查（`PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`）+ 覆盖守护（`PARAMETER_SEARCH_OVERRIDE_ON_UNREFERENCED_PARAMETER`）+ 顺序纪律 `派生→覆盖→剥离→校验`。**N-01 FIXED**（前置窗口校验，北京业务日，错误含两个窗口）。**N-05 保留并标记 LEGACY / PREVIEW**（旧派生器有真实消费者 = 技术预览 + 闭环 optimization；新增静态源码守卫测试钉住「PS 不得回退」）。**N-03 保持 DEFERRED**；**无性能改动**。验收：真实 tRPC E2E **13/13 PASS**（负例 ×2 + 参数引用正例 2 组合 + Resume + 自建自清）；全量 vitest 失败文件集合 **8→8 零新增**；新增单测 16 例。报告 = `docs/parameter-search/PARAMETER-002-REPORT.md`。
- **9bs. （PARAMETER-001 · Parameter Search 完整实现）** ✅ **已完成（2026-09-19）**：把已有 `server/research/parameterSearch/**` + `paramSearchRouter`（**零写库**技术预览）**收敛**为持久化搜索闭环 （Strategy Version → Parameter Space → Combinations → Backtest → Evaluation → Search Results）。**交付**：域层 8 文件（`searchSpace` / `parameterHash` / `combination` / `searchRun` / `searchResult` / `persistence` / `executor` / `coordinates`）+ 契约 `shared/parameterSearchContracts.ts` + 三表（26/10/23 列、**0 FK**、手工幂等 SQL `0041_parameter_search.sql` + `scripts/applyParameterSearch.mjs`）+ **同域扩 7 端点**（不新开 router）+ 前端面板（挂在 `/parameter-search` 顶部）。**R-05 修复**：`FIXED` 不进搜索空间、`DERIVED` 不得直接搜索（判据唯一落点 + 与 `listSearchableParameters` 等价的守护测试）。**确定性 `parameterHash`** + 撞 hash 响亮抛错；**状态机** 五态 + Retry/Resume 入口；**Resume / Retry / Cache** 全落地（cache 判据 = 规格 §13 五要素）。**指标零重算**（canonical metrics 只读数，`metricsSource` 如实标注）。**真实 E2E**：4 组合 39 s / 4-4 成功 / 二次 start 全跳过（37 项断言 0 失败）。⚠️ 遗留三项（前置窗口校验 / 4 组合指标相同且 0 成交 / `backtestRunId` 恒 NULL）已登记。报告 = `docs/parameter-search/PARAMETER-001-REPORT.md`。
- **9bi. （Strategy Core 一次性实施 · STRATEGY-ARCH-001）** ✅ **已完成（2026-09-19）**：新增 `server/strategyCore/**`（20 文件 / 6806 行）+ `tests/server/strategyCore/**`（112 用例）—— 把 Strategy 收敛为「版本身份 + RuleGraph + FeatureRegistry + ParameterResolver + DataRequirements + ExecutionSemantics + Capabilities + StrategyRuntime + StrategyDecision + LeakageGuard + Fingerprint + RunSnapshot」，成功标准见规格 §25。**零已跟踪文件改动 / 零迁移 / 零新端点 / 零前端改动**；`tsc`=0 · 全量失败集合与基线逐项一致（8/17，零新增）· `vite build` 成功。**⬜ 接产待做（下一 STEP）**：把生产链路（`researchRunRouter.loopRun` 的 `useRealData` 分支、`strategyEvaluation` 评估端口、`conditionSignal/compile.ts`）切到 `StrategyRuntime.evaluate`，并为「阈值型出场」补运行态引用（入场价 / 入场日）以进 `exitRuleGraph`；判据 = Core 成为**唯一**求值入口（legacy `signalEngine` 只保留兼容适配，不再是第二套语义）。
- **9bi. （HOMEPAGE-002 · 首页第二轮改造 · 事项 `rKRNzQ`）** ✅ **已完成（2026-09-18）**：用户对首页（`/`）提 5 条要求，全部落地并真机验收。① **四指数并列 + 更小区块 + 更多日期**：`index_daily` 实查恰四条指数，改为四张并列迷你卡 × **120 交易日**（原 60）、单卡 276px。② **三合图双右轴 → 共享分类轴的两联图**（上联 家数柱+成交额线，右轴**仅一条**；下联 两融余额独占左轴，留占位右轴对齐绘图区），**零数据变换**。③ **连板梯队 ↔ 题材热力日历 换位**。④ **连板梯队改「高度 × 网格」版式**（对齐用户附件）：左列 `N 板` / `首板(N)`、右侧 6 列网格、格内三行（首封时间 / 名称 / 题材），断板整名删除线 + 首行改显当日涨跌幅，一字板红标。⑤ **首屏分块渲染**：删除全页 spinner，改每卡自持 query + 骨架屏 + `staleTime 5min`。**交付面**：`client/src/pages/Dashboard.tsx` 重写（拆四段）；`server/boardRoster.ts` 增 `firstBoardStocks` / `changePct` / `oneWordBoard`（**一次有界行情查询**，≤100 行）；`server/db.ts#getLimitUpWithMarketData` 改**服务端 `GROUP BY` 聚合**（口径逐字不变）。**验收**：`tsc`=0；定向单测 20/20；全量 **8 failed files / 17 failed tests = 基线，零新增**；行尾 **0 漂移**；CDP 探针 **33/33 ALL PASS**。**边界**：零迁移 / 零新表 / 零新依赖 / **零新端点**；报价侧未新增写口（本任务只读）。**遗留（须用户定）**：连板高度口径「连续记录交易日」vs 附件源「N天M板 累计」差 1 板；2026-09-16 两处名称错录。🔁 **口径修订（2026-09-18，见 §44.5 `9bj`）**：本条对 1 板差的归因（「附件源 = N天M板 **累计口径**」）**已作废**；用户裁定其含义为**「若该股本日涨停会达到的连板数」**，并已落地（`shared/ladderHeight.ts`：断板 +1、首板未续不 +1），五只断板股逐只与附件图对齐。详见 `docs/evidence/README.md` `homepagerework` 节。
- **9av. （STEP 0 · 研究链清障与可观测 / RESEARCH-ORPHAN-RECLAIM-001）** ✅ **已完成（2026-09-17）**：三项全落地 —— **0-1 收敛残骸**（实测改判：只收敛真孤儿 `research_analysis 270008`，**不碰**用户草稿 `run 630002`）、**0-2 孤儿回收**（`reclaim.ts` 唯一实现 + `engine.ts` 源头修复 + boot 挂载）、**0-3 体检端点**（`researchRun.chainHealth`，只读，`gaps` 指出断环）。**顺便纠正审计报告一处事实错误**（把「未执行草稿」误判成「PENDING 残骸」）并**精确化「在途」判据**（在途 = `RUNNING`）。验收：`tsc`=0 / `reclaim.test.ts` 8-8 / 全量 8 failed（**本轮零新增**，第 8 个为 `9at` 遗留）/ `vite build` 成功 / live 端点 200。边界：零迁移、零新依赖、零新表；`server/**` 571 → **573**。报告 `docs/research/STEP-0-RESEARCH-ORPHAN-RECLAIM-001-implementation.md`，详见 `ROADMAP-CHANGELOG.md` 同名条目。
- **9aw. （STEP A · 打通「条件 → 回测信号」）** ✅ **已完成（2026-09-17）**：审计报告 P0-1 已消除 —— 策略文档的 `definition.entry.conditions` **首次真正成为回测信号**。**A-1**：新增 `server/research/conditionSignal/`（`compile.ts` 唯一实现 + barrel），三张**闭集**表（派生字段恒等映射 / 运算符→门槛 / **8 条可证明等价改写**）；`EQUIVALENT_REWRITES` 采用「**源运算符 → 目标门槛**」显式映射 —— 🔴 初版把源运算符直接当目标门槛用，令 `bar.low >= prefix.rd0.open`（守线）译成 `haircut >= 0`（**语义相反**），已修并被单测钉死；等价改写是**方向翻转**的（`low >= o0 ⇔ haircut <= 0`）。右值三种：`CONSTANT`（须有限数字，**存量字符串常量 `"prefix.rd0.volume * 0.3"` 被拒**）/ `PARAMETER_REFERENCE`（须在文档 `parameters` 里，取值时缺值**响亮抛错**，解 gap #5「阈值来自参数」）/ `FIELD_REFERENCE`（仅等价改写路径）。**A-2**：`assemble.ts#requireRecipe` 改为**三条诚实路径**（文档带 recipe → 声明式条件现场合成 → 显式兜底），新增 `RecipeResolutionSource = "strategy-declarative-conditions"` 并同步 `shared/researchContracts.ts` zod 闭集；🔴 **顺序约束（勿调换）**：路径 1 必须先于路径 2 —— 实查 7 份 `cand-3600xx` 文档 `hasRecipe=true` 且条件是死写法字符串常量，提前会让它们从「能跑」变「一跑就报错」。`recipeRegistry.ts` 抽出 `makeStrategyRecipeRuntime` 供注册表与合成配方**共用一份**构造与注册期校验（禁第二套口径）。**前置取证（先查真库，并推翻报告隐含假设）**：全库 10 份文档中**唯一**「无 recipe 但有条件」的是 `strategy_versions#390001`（`cand-270001@1.0.0`，2 条条件且均为 `FIELD_REFERENCE`）⇒ 行为变化面**恰好 1 份**；报告所述「候选从不声明 recipe」不确 —— 7 份 `cand-3600xx` 转正时都写了 `first-limit-pullback-hold-shrink`。**验收五层全绿**：`tsc --noEmit` = exit 0；新单测 `tests/server/research/conditionSignal/compile.test.ts` = **28 / 28**（用「恰好守平通过 / 略微跌破剔除」把方向钉死）；全量 `vitest run`（251 files / 4172 tests）= **8 failed / 17 failed tests，与上一轮基线逐项一致 ⇒ 本轮零新增**（改动面内 3 个测试文件全 ✓）；`vite build` 成功（15.16s）；**只读探针** `docs/evidence/_probe_step_a_declarative_recipe.mts` 4 项取证全通过 —— ①影响面恰 1 份 ②编译产物 `haircutFromEventLow lte 0 且 volumeRatio lt 1` 且三支行为探针（守线且缩量 `true` / 跌破开盘价 `false` / 放量 `false`）符合预期 ③装配层 `recipeSource = "strategy-declarative-conditions"`、`signalDescription` 与直编**逐字一致** ④负例（注入 `event.limitUpPrice`）⇒ `CONDITION_NOT_MAPPABLE` **逐条定位「第 3 条条件」**、绝不回落默认配方。**边界**：零迁移 / 零新表 / 零新依赖 / 零新端点 / `client/**` **零改动**；`server/**` 573 → **575**、`tests/**` +1；**未做端到端 `loopRun`**（同步长请求且写库），判据「signals 与独立复算逐日一致」留作下一步；`strategy_versions#390001` 运行时行为**会改变**（此前跑默认配方，现在跑文档声明的「守线 + 缩量」）属**期望修正**，且**未改动任何库内数据**。报告 `docs/research/STEP-A-DECLARATIVE-CONDITIONS-implementation.md`，详见 `ROADMAP-CHANGELOG.md` 同名条目。
- **9ax. （STEP B · 让评价 / 绩效 / 参数真正共通复用）** ⬜ **待做**：审计报告 P0-2 / P0-3 —— `paramSearch` / `walkForward` / `marketRegime` / 绩效看板**只调 legacy `getLeaderCandidateBacktest`，从不读策略文档**（`strategyId` 仅作记录标签；参数只认 8 个 legacy 字段，未收录维度**被静默忽略**）⇒「策略评价 / 绩效 / 参数共通复用」**当前不成立**；且闭环 14 阶段**只有 6 个有执行器**。**落点**：① 新增**策略回测评估端口**（唯一实现：入参 `{strategyId, strategyVersion, dateRange, parameterSet}` → 走 `assembleRunWorkbenchInputs` + `runTradeSimulation` → 出标准绩效标量，**复用** `performanceMetrics` / `riskAdjustedMetrics` / `tradeQualityMetrics`，**不新写指标**）；② 三个 router 的评估标量改调它，参数空间**从策略文档 `document.parameters` 派生**（已定决策）；③ 把闭环 4 个 notWired 阶段（`optimization` / `robustness` / `oos` / `overfitting`）接上**现成执行器**（`parameterSearch` / `rollingOptimization` / `robustness` / `stochasticRobustness` / `walkForwardRun` / `oosIsolation` / `overfittingDetection` 代码早已写好，**纯接线**）；④ `parameterSearch` 产出的候选经**现有** `strategyCandidate` 桥回写，**不建第二写口**。**判据**：同一策略、同一参数集，**闭环 evaluation 标量 == 参数搜索评估标量**；闭环 `executedStageCount` 由 6 升到 10。（`paper` / `review` / `discipline` 三个阶段需人工标注数据注入，**暂不做**。） **进展（2026-09-17，仍 ⬜ 待做）**：落点①（评估端口 `server/research/strategyEvaluation/`）与**落点③ 的第 1 个阶段 `optimization`** 已交付且取证通过（探针实测 6 阶段全 `EXECUTED`）——详见报告 §9–§12 与 `ROADMAP-CHANGELOG.md` 同名条目。**未做**：落点③ 其余 3 阶段（`robustness` / `oos` / `overfitting`）、落点②（三个 router 改调）、落点④（候选回写）。⚠️ 原判据「闭环 `executedStageCount` 由 6 升到 10」**需按实测重写**：闭环 `requested` 是可裁剪的，实测 6 阶段链为 **6 / 6**；全 14 阶段下**有执行器的是 8 个**（`data`/`research`/`strategy`/`backtest`/`evaluation`/`optimization`/`regime`/`finalize`；其中 `finalize` 由编排器**内置路径**完成，不注册执行器）。 **进展（2026-09-17 · 落点② 第 1 里程碑，仍 ⬜ 待做）**：**`paramSearch` 已改走策略评估端口** —— 探针实测 `evaluationSource = "strategy-document"`、参数空间从文档派生（`max_drawdown / max_volume_ratio / require_bullish`），前端 `ParameterSearch` 页亦已支持填策略身份与决策窗口并显示口径。**未做**：`walkForwardRouter` 同构改造（模式已验证，但需先解其并发预计算与桥缓存的冲突）、`robustness` / `oos` / `overfitting` 闭环阶段、`paramSearchRouter.rolling` / `.robustness`。⚠️ **原判据「`executedStageCount` 由 6 升到 10」已按实测重写**：闭环 `requested` 可裁剪，全 14 阶段下有执行器的是 **8 个**。🔴 新发现的真实约束：**单组策略评估约 3 分钟**（完整闭环）⇒ 参数搜索在真实数据上必须用 `random` + 小 `budget`。
- **9ay. （STEP C · 交易模式单一声明库 Pattern SoT —— 用户最终目标的落点）** ✅ **已完成（2026-09-17）**：**2026-09-17 22:10 GMT+8 · PATTERN-LIBRARY-001（`9ay`）—— 交易模式单一真源落地：新增一种模式 = 1 个声明文件 + 1 行清单，研究侧与执行侧由同源构造保证一致**。**① 新增 `server/research/patternLibrary/`**：`types.ts`（声明类型，**零运行时依赖**，全 `import type`）+ `patterns/`（8 个模式声明 = 6 纯研究 + 1 双栖 + 1 纯执行）+ `project.ts` / `projectRecipe.ts`（研究侧与执行侧投影，**唯一实现**）+ `index.ts`（barrel + `requireTradingPattern` / `listPromotablePatternIds`）。**② 迁移（原样 + 零回归）**：7 个研究模块与 2 个配方迁入声明库；`moduleRegistry.ts` 删 **280 行**手写工厂（`createDefaultResearchModuleRegistry()` 改为遍历声明库），`recipeRegistry.ts` 运行时原子下移到新文件 `recipeRegistryAtoms.ts`（**154 行**）并 re-export 保持导出面、2 条手写配方（**39 行**）改为投影。**③ 零回归硬证据**：迁移前后跑同一只读探针，行为快照（含 7 模块全部字段 + 每条条件配方在 3 组 ctx 上的 `build` 结果 + 2 配方在 3 组参数 × 4 组特征上的信号 + `resolveParameters` 四条路径）**逐字节相等**：50973 B = 50973 B。**④ 新增能力（都对症既有缺陷）**：`definitionBuild.ts#buildParameters` 改为读草稿声明的 `parameterRole`（缺省仍 TUNABLE ⇒ 既有草稿零回归）—— 这是 P1-1「`parameterRole` 有声明无消费者 ⇒ 固定参数只要带 min/max/step 就被搜索」的对症修法；`createCandidate` 新增可选 `patternId` ⇒ 候选自动带 `entryRule.extra.recipe` 与 `parameterSpace`（**打通「分析 → 转成正式策略 → 能回测」**，此前该槽位只能人工填，缺它就是 P0-4 的现场）。**⑤ 循环 import 的两个手法（本轮真踩到）**：`moduleRegistry` ↔ `patternLibrary/project` 互相 import ⇒ (a) **原子下移**（`recipeRegistryAtoms.ts`）打破循环；(b) **惰性单例**（`defaultResearchModuleRegistry()` / `registeredRecipes()`）—— 🔴 初版是顶层常量，`tsc --noEmit = 0` 但 vitest 报 `TypeError: buildPatternModuleSpecs is not a function`（**类型检查看不出求值顺序**，这类缺陷只有真跑才暴露）。**⑥ 验收**：`tsc --noEmit` = exit 0；新增 `patternLibrary.test.ts` **37/37**；全量 `vitest run` = **8 failed / 17 failed tests，失败文件集合与基线逐项一致 ⇒ 零新增**（用例 4204 → 4241）；`vite build` 成功（27.80 s）；行尾哨兵 0 漂移；`server/**` = **594**、`tests/**` = 254，16 个新文件全纯 LF。**⑦ 判据核对（`9ay` 原条目）**：① 新增一种模式 = 1 个声明文件 + 1 行清单（不改任何注册区）✓；② `intent` 能识别（模块经注册表进入 planner）✓；③ 计划能生成 ✓；④ 候选能带 recipeId ✓（本轮接线 + 单测）；⑤ 回测信号与该模式一致 = **真实库全链 e2e 25/25 通过**（`docs/evidence/_e2e_pattern_promote_backtest.out.txt`）：装配层解析出的是本模式配方（非兜底）、真实回测 5 阶段全 EXECUTED 且产出 `totalReturnPct = 4.9272%` 等真实标量、行数逐表守恒。真机另暴露 2 个真实缺陷（草图漏 `trigger`；`filterRule` 研究侧命名 ⇒ 改为不写它、由 `buildGates` 承载）均已修，3 处判据/坐标写错已自纠（详见报告 §9）。**⑧ 边界**：`client/**` **零改动**；未跑真实库 e2e；P0-2 / P0-3 的彻底解即本轮；P1 其余条目（执行语义 / 吞错 / 投影表无人查询）与 P2 未动；`9ax` 剩余（walkForward / robustness / oos / overfitting）未动。详见 `docs/research/PATTERN-LIBRARY-001-implementation.md`。
- **9az. （STEP D · 正确性与体验收口）** ⬜ **待做**：① **`OR` / `NOT` 被静默压成 AND**（`definitionBuild.ts#buildConditions` 把条件分组扁平化 push 进一个数组，而 `ConditionDefinition` **无逻辑运算符字段**）⇒ 二选一：给 `ConditionDefinition` 加逻辑位，或 promote 时**响亮拒绝** `OR`（**禁静默压成 AND** —— 用户说「或」而策略变成「且」是语义篡改，且不报错、不留痕）；② **「模式库」页面**：展示系统会哪些模式、每个模式能表达什么 / 不能表达什么（`listModules` 端点**已有** ⇒ 纯前端）；③ **冷算阻塞（`9aq`）**：stale-while-revalidate —— 数据戳不匹配时**立即返回上一版 + 渲染显式 stale 横幅**，后台重算后原子替换（**禁静默显示旧数据**；详见 `9aq`）；④ **孤立模块接线**：`factorAblation` 接入闭环 `overfitting` 阶段、`signalToPnl` 明确归属或如实标「未接线」（当前二者全库无生产调用方）。
- **9au. （RESEARCH-PLANNER-001 缺陷 780001 · 「创建候选」取错分析致恒失败）** ✅ **已完成（2026-09-17）**：修复用户实测缺陷「创建候选失败 分析 780001 没有任何条件，无法导出候选题筛选条件」。**A 审计先行**：先读 `analysisPlan.ts` / `ResearchAsk.tsx` / `researchPlannerRouter.ts` 三方真实代码，再跑只读探针复现，零猜测。**B 根因**：结论页前端 `find((a) => a.priority === "P0")` 挑中的是计划**第一条** `EVENT_STUDY 全样本基准`（`required: true` 但天然无条件行）⇒ 服务端按 §16 设计拒。**C 修法（服务端唯一权威）**：`server/researchEngine/planner/aggregate.ts` 新增 `conditionCount / requiredFlag / isQuestionEmphasis` 三字段 + `ResearchOutcome.candidateEligibleAnalyses` + **唯一排序实现** `rankCandidateSourceAnalyses()`（硬门槛 + 五级排序 + 人读 `why`）；`server/researchPlannerRouter.ts` 新增 `resolveCandidateFilterSource()` 三分支（EXPLICIT 严校验 / AUTO 取第 0 条 / NONE 不静默）+ 新增返回 `filterRuleSource`（含 `eligible` 清单与 `note`）；前端**删掉「自己挑分析」**（那段就是缺陷现场），改为创建**前**展示「会用哪条分析的几条条件」、创建**后**回显实际来源、零条件时琥珀色警告。**D 相邻缺口**：`getOutcome` 的 `{runId}` 入口原本不解析 plan/question ⇒ `provenance.complete === false` + §13 提问锚点失效，已顺 `research_analysis.planId` 反查补齐，两入口等价。**E 验收**：`npx tsc --noEmit` = exit 0；`_verify_candidate_filter_source.mts` **41 / 0**（跑在用户真实失败的 Run 780002 / Plan 120002）；`_probe_research_ask_page_render.mjs` **27 项 ALL PASS**（零回归）；真机 4 次运行（后 1 次为 v2 数据集 390002）**`ALL PASS`**，Candidate `#750001`。**F 边界**：**零迁移 / 零新端点 / 零新依赖 / 零新表**；`server/**` = **571** 文件（零增减）；Candidate 仍全为 `DRAFT`（人工确认未被绕过）；`RESEARCH_READY` 未变 TRUE。报告 `docs/research/RESEARCH-PLANNER-001-defect-780001.md`。详见 `ROADMAP-CHANGELOG.md` 同名条目。
- **9at. （RESEARCH-PLANNER-001 · 自动研究编排层改造）** ✅ **已完成（2026-09-17）**：把 Research 从「用户手工堆 Analysis 参数」升级为「用户只填 Dataset + 一个问题，系统自动设计 / 执行 / 聚合 / 下结论」。**入参真的只有两项** `{datasetVersionId, researchQuestion}`（§5 / §27）。**A 审计**：先读码定位真实缺口（无 Research Module 概念 / 无 Planner / 无提问锚点 / hypothesis 未注册）再动手，零猜测。**B 领域 + DB + API**：新增 `server/researchEngine/planner/` 六文件 —— `moduleRegistry.ts`（7 个内置研究方法 + **可扩展注册**，与 `AnalysisExecutorRegistry` 同构）、`intent.ts`（两档加权打分：专指词权重 3 / 泛化词 1）、`analysisPlan.ts`、`questionPlanning.ts`、`aggregate.ts`、`errors.ts`；新增 `server/researchPlannerRouter.ts` **10 端点**（createQuestion / getPlan / getQuestion / listQuestions / runResearch / runResearchDetached / getOutcome / **runFromQuestion** / createCandidate / listModules）。**迁移 2 条**：`0039_research_planner.sql` + `0040_candidate_plan_provenance.sql`（`research_strategy_candidate.sourceResearchPlanId` 补齐 §16 六项溯源之一）；零 FK 不变；禁 `db:push` / `drizzle-kit generate`，走「`schema.ts` → 手写 SQL → 幂等 apply 脚本 + `information_schema` 断言」。**自动 Analysis**：条数不硬编码（`MAX_ANALYSIS_PER_PLAN` 20~50 / 默认 30），超限「按优先级保留核心 + 降次要维度 + 如实列出被裁项」而**不报错**；每条带 `priority / purpose / required`（P0/P1/P2）。**Finding / Conclusion**：新增 `questionAlignedFindings` + `questionAlignment` + `composeQuestionAnchor()`（结论正文三段：【研究问题】/【针对该问题】/【统计判定】）——**只做筛选与排序、零重算统计量**（§21）。**前端**：`/research/ask` 四态步骤机（ASK → PREVIEW → RUNNING → OUTCOME），默认模式首屏只有 Dataset / 版本 / 研究问题；复杂页面保留为「高级 / 专家模式」；侧栏「提问研究」（分段精确匹配高亮）。**H §27 首板回踩 E2E**（`_e2e_research_planner.mts`，**37 / 0**）：`experimentId=480001` / `researchRunId=750001` / `planId=90001` / Candidate `#570001`；意图 `PULLBACK_EFFECTIVENESS`（`fallbackApplied=false`）；计划 **28 条**（P0 4 / P1 21 / P2 3）；**28 / 28 完成、528 结果行**；23 Finding → 展示 8；结论 `SUPPORTED` 且 `researchQuestion` = 问题原文、正文含【研究问题】/【统计判定】、**无占位符**；1 条零结果（`market_cap 分位 → T+5`）⇒ `dataValidity.passed=false` 如实点名、建议 `NEEDS_MORE_RESEARCH`（证据残缺时绝不给 `WORTH_NEXT_STAGE`）。**I §28 第二问题复用验证**（`_e2e_research_second_question.mts`，**36 / 0**，走 `runFromQuestion` 单次调用）：`experimentId=480003` / `planId=90003` / `researchRunId=750003` / Candidate `#570003`；**深档 2 条 + 浅档 2 条**（修复前只有「浅」一档进计划）；精修顺序 `depth_deep → depth_shallow → shrink_50 → shrink_30 → last_expansion → last_bullish`；提问锚点 `EMPHASIS`，4 条深度分档 Finding **全部**进「针对你的问题」。**研究答案**：深档（`close_ratio ≤ 0.95` 且未破首板开盘价）T+5 均值 **−6.97%**（超额 **−8.49pp**，n=1602）vs 浅档 `[0.98,1]` **−1.42%**（**−2.94pp**，n=2841）vs 基准 **+1.52%** ⇒ **回踩越深越差**，与 `RESEARCH-FINDING-001` B9 的「−2.6% / −5.1% / −8.8%」方向一致（两条独立路径互证）。**复用验证**：执行器仍为 `RESEARCH-002` 的 **6 类**（断言逐字一致）⇒ 零新增执行器 / 表 / 入口 / 依赖。**真机渲染验收**（`_probe_research_ask_page_render.mjs`，无头 Edge + CDP）：**27 项 ALL PASS** —— §17 默认模式控件总数 = **4**、禁用词命中 **0**、示例 **3** 条可点、清空后提交被拦住（3 条原因）**且不进预览**、侧栏高亮正确。**验收**：`npx tsc --noEmit` = exit 0；兜底重跑 `darkCompatibility.css` 生成器（310 组合 → 230 规则 / 38595 B）。**🔴 本轮实测修掉 7 个缺陷（全部由 E2E / 探针暴露，非推演）**：① 两个验收问题都被识别成 `EVENT_RETURN_RESEARCH`（`"不破"` 匹配不到 `"不跌破"`；等权打分把泛化「收益」与专指「回踩」算成平手）⇒ 两档关键词权重 + 三级排序（修复后两问均 → `PULLBACK_EFFECTIVENESS`，计划 8 → 28 条）；② 对照组 `== 0` 的口径回执语义写反（写成「未跌破」）⇒ 新增 `applyOperatorSemantics`；③ `withDisclaimer` 定义了但**从未被调用** ⇒ `pickConclusion` 拼后缀 + `recommendation.disclaimer` 唯一注入点；④ §22 误导性真话（`market_cap 分位` 零结果却报「✓ Passed」）⇒ 新增 `emptyResultCount` / `emptyResultAnalyses`，`passed` 改三条件；⑤ 深度分档只有「浅」一档进计划（`slice(0, 6)` **先截断再排序** ⇒ 注册序第 7/8 位永远进不了计划）⇒ `emphasisKeywords` + **先排序再裁剪**（修复前后对照 `_probe_planner_dryrun.before-fix.txt`）；⑥ 结论正文含占位符「(未登记假设陈述)」且两轮结论数字逐字相同 ⇒ Planner 注册 hypothesis（`statement` = 用户原话）；⑦ 用户问的问题在结论页读不到答案（`researchStrength` 在 1.0 饱和 ⇒ 样本量成事实上主导排序）⇒ `emphasisAnalysisNames` + `questionAlignedFindings`。**边界**：`RESEARCH_READY` 不因「结果可看」变 TRUE；**没有**推送任何 Candidate 进 Strategy（全保持 `DRAFT`，人工确认仍在）；`ResearchExperimentV2` / `AnalysisV2` / `FindingV2` / `ConclusionV2` 一律未建；`server/**` = **571** 文件（基线 553 + 本轮 18）。报告 `docs/research/RESEARCH-PLANNER-001-implementation.md`（10 节 / 8 项交付物）。**遗留 P0 阻塞项：无**（3 项待排期属口径类，不阻塞 Strategy / Backtest）。详见 `ROADMAP-CHANGELOG.md` 同名条目。

- **9as. （RESEARCH-FINDING-001 · Research Finding & Hypothesis Engine）** ✅ **已完成（2026-09-16）**：Result → Finding → Conclusion → Hypothesis → Candidate 五段闭环。B1~B10 全落地：B1 迁移（`research_finding` 表 + 3 表扩列）、B2/B3 领域 + 仓储、B4 六维确定性 Finding Engine（只消费 `research_result`，绝不重扫 Dataset）、B5 结论升级 + 引擎接线（`writebackHypothesisStatus` 逐级推进）、B6 tRPC 端点（finding/hypothesis/candidate）、B7 前端（FindingsPanel + 提假设弹窗 + findingToVm）、B8 闭环集成测试、B9 真实数据验收（dataset 390002 / Run 570001 / Finding 1~13，§27 三问全检出）、B10 报告 + 总控。验收：`tsc`=0；研究套件 26 files / 433 tests 全绿；全量 4106 passed / 16 failed（失败全在既有基线文件）。报告 `docs/research/RESEARCH-FINDING-001-implementation.md`。**遗留**：20 条未覆盖组合回传 `untestedInteractions`（§12 如实，不造 Finding）。详见 `ROADMAP-CHANGELOG.md` 同名条目。

- **9h. （RESEARCH-002D，待决策）为研究 Run 补「启动时回收孤儿 `RUNNING`」钩子** ✅ **已完成（2026-09-17，由 `9av` 落地）**：**动机 = 2026-09-11 22:48 真实事故** —— `dev` 脚本是 `tsx watch server/_core/index.ts`，改任何 `server/**` 文件触发热重启 ⇒ **在途研究 Run 的执行器随进程消亡，Run 永久停在 `RUNNING`**；而 `run()` 要求 `PENDING|FAILED|CANCELLED`、`runIncremental` 要求非 `RUNNING` ⇒ **实验被完全锁死，且无任何产品级恢复入口**（本轮只能人工脚本收敛）。**同构参照（已落地）**：dataset 构建侧 `reclaimOrphanBuildJobs()` 由 `server/_core/index.ts` 在 `server.listen` 后调用（判据 = `RUNNING` 且 `updatedAt` 停更 > `DATASET_RECLAIM_STALE_MINUTES`，默认 10 分钟），DATASET-LIFECYCLE-001 已用它自动解困卡死 23h 的 v2 幽灵作业 ⇒ **研究 Run 侧缺失同样兜底**。**待决策的两个判据（须先定）**：① **boot 时任何 `RUNNING` Run 即孤儿**（最严格、最贴合「执行器随进程消亡」的语义；但多实例部署下会误杀另一实例的在途 Run）；② **复用停更阈值**（与 dataset 侧一致；但对「5 分钟即被热重启杀掉」的 Run 要等到 10 分钟才回收，期间 UI 仍显示执行中）。⚠️ 需同时决定**是否确立「单实例假设」**（项目对 dataset 构建已按单实例处理）。**落地要点**：收敛时须一并写 `errorCode`（如 `RUN_ORPHANED`）+ `errorMessage`（写明「被进程重启中断」）+ `completedAt`，并把 Experiment 一并置 `FAILED`（与引擎「执行中失败 → Experiment FAILED」口径一致）；**禁**只改 status 不清残留（这正是本轮修掉的缺陷）。**验收应含**：boot 回收幂等、不误杀非 `RUNNING`、回收后 Run 可重新执行。⚠️ **该缺口已第二次产生真实卡死实例**：2026-09-12 15:37 人工收敛 Run 330003（`RUN_ORPHANED`，见 §47 15:40 条）；在此之前它已停更约 16.6 小时。 **落地结果（2026-09-17）**：`server/researchEngine/reclaim.ts#reclaimOrphanResearchWork()` + boot 挂载于 `server/_core/index.ts`（`void` 异步、不阻塞启动、三类日志含「保留草稿」）。判据取**保守第三路**（`9h` 给的两个候选都不是最优）：① 父 Run 已终态且**过 30 分钟缓冲** ⇒ 子 Analysis 收敛 （隔离「刚失败正要点重跑」的竞争）；② Run 置 `RUNNING` 后**停更超 12 小时** ⇒ Run 收敛 `FAILED` + `RUN_ORPHANED` + 子分析收敛 + Experiment 回滚（仅当无其它 RUNNING Run）。**并把 `9h` 未考虑的形态「父终态子未终态」纳入** —— 实测现场真正存在的正是它（`research_analysis 270008` / 父 `330003` = FAILED）。🔴 父 Run `PENDING` **一律不动**（`inputSnapshot`+`startedAt` 皆空 = 未执行草稿，实测 `630002` 属此类，回收会破坏用户数据）。同轮另做**源头修复**（`engine.ts#settleAbandonedAnalyses`）⇒ 不再产生新孤儿。详见 `9av`。

- **9s. （RESEARCH-009B · 呈现修复）`max_return`/`min_return` 口径不该产出 `WIN_RATE` ＋ 指标标签未按目标变量口径改写** ⬜ **待做（需改代码 ⇒ 必须排到「无在途 Run」的时段）**：由 9r 的落库结果暴露（**数字全对、呈现会读错**）。(a) **引擎侧**：`analyses/segmentRelation.ts:124` 的 `winRateMeaningful = windowB.stat !== "max_drawdown"` 判断不全 —— `max_return` / `min_return` 同样是**极值口径**，「取值 > 0 的占比」不构成胜率（实测 A2 = **94.5%**、A3 = **2.7%**），应一并屏蔽并给出同款说明；顺带核对 `conditional.ts` 把 `MAX_DRAWDOWN` 作为附加指标时的口径标注。(b) **前端侧**：`researchEngineAdapter.ts` 的 `METRIC_LABELS` 是静态表 ⇒ `max_return` 目标的「平均最大有利偏移 +13.75%」显示成「平均收益」；应新增「按目标变量口径改写标签」的纯措辞函数（**只改措辞、不改数字、不重算**，遵展示层纪律），至少在表头 / 结论速览 / 图上生效。(c) 附带：B 组三个分析的 `ALL` 基线 n 不同（22,958/22,951/22,944），结果页应说明「对照组分母按各目标变量可用样本计」，避免被当成数据不一致。

- **9w. （RESEARCH-010B · 三问审计更正）「回撤深度档」表述更正 + 数据集未启用回踩筛选 + 「加筛选即前视」预警** ⬜ **部分待做**：2026-09-12 20:50 用户三问（T+1~T+5 × 回撤深度是否完整 / `segment_return_*` 收益起点 / 有无 look-ahead），只读实查后得三条结论：**(a) 表述更正（文档层，已改 `docs/research/RESEARCH-010-implementation.md` §十）** —— A/B/D 组的「等频 5 档」切在**带符号**的 `future_return_{d}d`（= `close(T+d)/close(T) − 1`）上，实测 T+2 切点 `−4.51% / −1.05% / +2.26% / +7.67%` ⇒ **档4/档5 = 「没回撤、还涨」样本（T+2 合计 ≈9,441/23,604 ≈ 40%）**，**只有档1 是深回撤**；且切点逐日变化（T+1 档1 ≤ −3.16% vs T+5 ≤ −7.69%）⇒ **同一列不可跨天比较**，正确读法是「相对首板收盘的涨跌幅 5 档」。**(b) 数据集事实（已确认，需写进 Dataset 层规则）** —— `dataset_version 390002` **未启用回踩筛选**：`filterDefinitionJson` 无 `pullback`、`universeDefinitionJson` 只有 `{all-a-shares, stock_daily_prices, boards:["main"], excludeSt:true}`、生产它的 `server/datasetRegistry/builder.ts` 不含 `screenFirstBoardRow` ⇒ 样本 = **全部首板事件**（主板/非 ST/23978 事件/2967 只），不是「有效回撤事件」。**(c) 🔴 预警（待决策，务必在启用回踩筛选前裁定）** —— `researchDataset/pullback.ts#screenSingleTarget` 的 `broken` 是**用整个 T+1..T+5 的 `low`** 决定入池；若将来以 T+2 为决策点做分析，就是**样本选择层 look-ahead**（幸存者偏差，会人为抬高 T+2 胜率）⇒ 必须改成**按决策日滚动的窗口**（T+1..T+d）重算入池，否则不可当作 T+d 可交易信号。**(d) 队列项（沿用 9u 建议）** —— 固定桶只做了 T+2/T+3（缺 T+1/T+4/T+5 × 5 桶 = 15 格）、1D/3D 视界未建（变量都存在 ⇒ 用**补跑**追加即可，零代码）。 ✅ **2026-09-12 21:50 由 9y 处理**：**(a)** 已从「文档层更正」升级为**分析元数据更正**（`450021~450024` 改名「深度5档」→「相对首板收盘涨跌幅5分位」；⚠️ `research_analysis` 无 description 列）+ §6.6 **离线量化对照**；**(d)** 固定桶已补齐为**完整 5×5**（T+1..T+5 × 5 桶 = 25 格，方法 = 25 组 `CONDITIONAL` × 5 指标），**1D/3D 视界同时建成**（B 组每格含 1d/3d/5d 目标，`segment_return_{d}_{d+1/3/5}d`）；**(b)(c) 结论不变** —— `390002` 仍未启用回踩筛选，且本轮**没有**给它加 whole-window filter（改用**离线只读复算**做对照，正是为避开样本选择层 look-ahead）。**仍未做**：滚动资格判定 `min(low[T+1..T+d]) >= open(T)`（见 9y 的 BLOCKED 与最小扩展方案）。

- **9y. （RESEARCH-007.1 · 分析建设线）「首板有效回撤 Research 校正与补齐」** ⚠️ **部分完成 / 核心一环 BLOCKED（2026-09-12 21:50）**：触发 = 用户 22 节规格（承接 9w）；**硬约束沿用上轮 = 「不新写代码，用现有功能实现，不能实现的列出来」** ⇒ **零产品代码改动**（`server/**` / `client/**` 未动、零迁移、零新端点、零新依赖）。**已完成**：① **错名校正** `450021~450024`（「深度5档」→「相对首板收盘涨跌幅5分位」）；② **新建 Run `540001`**（Experiment `240002` / Dataset Version `390002` / runNo=7 / COMPLETED）+ **135 个 `CONDITIONAL` 分析 `480001~480135`** + **1,952 行结果** + 结论 `480001` REJECTED（整轮 425.3 s，样本 23,978）—— A 组「已回撤」×5 + **B 组 5×5 固定业务桶 × 5 指标 = 125**（`segment_return_{d}_{d+1/3/5}d` + `segment_max_return_{d}_{d+5}d` + `segment_max_drawdown_{d}_{d+5}d`）+ C 组「T+5 加 `holds_event_low_5d == 1`」×5；③ **🔴 自查纠正桶区间**（**双闭** → **左开右闭**：首版 5 桶加总 **10,106 > 组 A 9,899**，多 207 正是平盘样本；改 `future_return < −lo AND >= −hi` 后重写 130 个条件 + 整轮重跑 ⇒ T+1/T+4/T+5 加总与组 A **逐位相等**，T+2/T+3 各差 1 例）；④ **离线交叉验证**（只读 SQL，非产品口径）：补上 `min(low[T+1..T+d]) >= open(T)` 后方向**同向且量级接近**（T+4×2~4%：+0.42% vs +0.38%），但 **8%+ 桶样本 4,474 → 215~226**、T+1×8%+ 最深跌幅 −8.47% → **−10.16%**。**🔴 BLOCKED（唯一硬缺口）**：规格要的**滚动资格判定**（基准 `open(T)`、按决策日 d 滚动）**现有领域模型表达不了** —— 数据层原料齐全（`prefix(rd=0).open` + `post(rd≥1).low` 实查都在），但变量层只有 `holds_event_low_{5,10,20}d`（基准 `low(T)`、只 3 个视界），**无 `open` 基准、无 d=1..4**；条件右值只能是常量 ⇒ §十九 的「**有效回撤**」问题**未答**。**最小扩展（待排期，⚠️ 须在无在途 Run 时段做，否则热重启会杀 Run）**：`EVENT_LOW_GUARD_BASES` 加 `"open"` + 生成视界由 `outcomeHorizons` 扩到 `pathHorizons∩[1,5]`（**单文件单函数、零 migration**）；随后用 `runIncremental` 补跑 T+1..T+4 的 4×5 格。**其余缺口**：`research_analysis` **无 description 列**；CONDITIONAL **不产 P25/P75**（DESCRIPTIVE 能产但不支持条件过滤）；无二维交叉分析类型；`updateAnalysis` / `setAnalysisConditions` **前端无入口**；Strategy Candidate **无前端入口**。**产物**：`docs/research/RESEARCH-007.1-pullback-correction.md` + 证据/脚本 9 个（均非产品代码）。**下一步建议**：① 缺口 ① 的最小扩展 + `runIncremental` 补跑；② 修 CONDITIONAL 附带 `max_drawdown_{h}d` 的口径推导（顺带解 P25/P75）。

11. **（建议 RESEARCH-003 = 在正确口径数据上做研究 + 补齐引擎边界）**：① 修上游 `liquidity_daily.totalMarketCap`/`circulationMarketCap` 全 NULL（解锁市值/流通盘特征）与 industry `effectiveFrom` 单点（解锁行业维度）；② 构建跨年跨板块的 Dataset Version（使 year/month/board 稳定性真正可评估）；③ 接入 `marketRegime22` 作为合法 `RegimeTagProvider`（解锁 regime 分组）；④ Dataset 定义交易规则后实现 `time_to_target`/`time_to_stop`。

12. **（数据完整性，2026-09-11 19:20 实查新增）两处「缺唯一约束」修复** —— 由 `scripts/verifyRawDataUniqueness.mts` 审计发现（**原始行情表全部已受唯一约束保护，重叠窗口回填幂等、无重复**，详见 §47 DATA-INTEGRITY-001）：① **`research_security_status_history` 缺 UNIQUE(securityId, statusType, effectiveFrom)**（真实库仅 PRIMARY，当前实测 0 重复，但 `pickLatest` 的 tie-break 是「任取」⇒ 一旦写入重复，PIT ST 判定会退化成由 `source` 字母序决定 5%/10% 涨跌停比例）→ 按 §迁移流程 补 DDL；② **`limit_up_records` 无业务唯一键**（实测 26 组 / 166 行多余，含 **143 行「测试」占位污染**（⚠️ 2026-09-11 19:35 更正：原记「258 行」是**判据过宽的误报** —— `%测试%` 会命中真实股名 `谱尼测试`/`西测测试` 与真实关键词 `封装测试`/`芯片测试设备`；改用前缀 `测试%` 后真实污染 = **143 行，全部是 `000001.SZ 测试股票`**：`2024-12-31` 142 行 + `2025-12-31` 1 行），最重一组 `2024-12-31/000001.SZ` 重复 142 条）→ 已污染 `getLimitUpCountsByDate`（`COUNT(*)`）/ 题材热度 / `marketRegimeRouter` 涨停家数（99,577 虚增为实为 99,411）→ **需确认后清理 + 决定是否补唯一键**（注意：同股同日「打开涨停后重新封板」是否属合法多记录需先定业务语义，不可盲目加唯一索引）。

13. **（连板高度口径，2026-09-11 19:35 实查新增）`boardCount` 字段与连板高度口径统一 + 数据缺口修复** —— 由 `scripts/verifyBoardHeightCaliber.mts` 审计发现（1/4 通过，详见 §47 DATA-INTEGRITY-002）：① `limit_up_records` 存在 **133 行「自称 N 连板但表内凑不出 N 天」的缺口**（如 `000078.SZ 2025-12-02 自称 5 连板、表内只有 1 天`）与 **30 行「记为首板但前一交易日同股已有记录」的断裂**（全部来自 OCR 链路）⇒ `db.ts#calculateConsecutiveBoards` 的邻接链在这些位置断开，**连板高度被低估为「首板」**，进而影响涨停梯队分布 / `leaderCandidates` / 高位连板风控；② **`boardCount` 字段是「死字段」**（页面与统计均不读它，而是读取时按表内日期集合重算）却与重算口径在 **160+ 行上矛盾**，且含两套格式（回填 `首板`/`N天N板`、OCR `1`/`N天M板`）⇒ 任何按该字段筛选的逻辑都会得到不一致结果；③ 🔴 **`scripts/backfillLimitUpRecords.mjs` 的连板计算存在潜在缺陷**：`const fresh = hits.filter(h => !existing.has(...))` 之后 `streak` 只在 **本轮新增** 上推进，不参考已在库历史 ⇒ **按间隔区间分批回填时，区间衔接日的连板数会被错误重置为「首板」**（当前数据未显现，因回填一次性跑完；修法 = 用「已在库历史 ∪ 本轮新增」的并集，且日期基准改用 `index_daily`）。

14. **（构建生命周期，2026-09-11 21:35 更新：治本已落地并实测验收）「取消构建 → 重新构建」数据完整性 + v2 死锁解困** —— 20:27 实查（见 §47 DATASET-LIFECYCLE-001）后，用户指令「**根治这个问题，取消构建后就要删除数据**」，本轮已全部落地：
   ① ✅ **治本 A —— 孤儿作业回收已实现并已生效**：`registry.reclaimStaleJobs()` 扫描「`status='RUNNING'` 且 `updatedAt ?? startedAt` 停更超阈值」作业 → **条件** `transitionJob(RUNNING→CANCELLED)`（防与真实执行者竞争）→ 版本 BUILDING→FAILED → 清空该版本数据行；启动钩子 `reclaimOrphanBuildJobs()`（`server/_core/index.ts`，阈值 env `DATASET_RECLAIM_STALE_MINUTES`，默认 10 分钟）。**实测已自动解困**：v2 幽灵作业 `540001` 被回收（`errorMessage="orphan reclaimed：停更 55 分钟无进度更新"`）⇒ v2 死锁解除，应用侧 21:24 已成功对 v2 发起重建（`job 630008`）。**无时间基准 → 跳过不回收**（诚实，不误杀）。
   ② ✅ **治本 B —— 「重建 = 从零」已实现**：`runner.execute` 在 `builder.build` **之前**调用 `service.purgeVersionRows(versionId)`（分批 5000 行 DELETE、按 `datasetVersionId` 逻辑隔离、表结构保留、其它版本不受影响）。依据：清场必须早于 build，且 upsert 是 `ON DUPLICATE KEY UPDATE id = id`（空更新）⇒ 不先清场必然留新旧混合。
   ③ ✅ **「取消 = 回滚」已实现**：新增 `service.cancelJobAndRollback()`（唯一权威用户可见取消入口）+ `runner.waitForStop()`（**可等待停止**，超时 60s）。router `cancelBuildJob` 顺序固定为 **`runner.cancel` → `await waitForStop` → `cancelJobAndRollback`**；未在超时内停止 → 只置取消态 + 返回 `rollbackSkippedReason`（**绝不静默假装已回滚**）；重复取消**幂等**（不抛 `INVALID_JOB_TRANSITION`，只补做回滚 + 版本态兜底）。**新增例外（防止回滚变成数据销毁）**：版本仍 READY ⇒ 本轮**尚未接管**（清场在 `markBuilding` 之后）⇒ **不回滚**，`rollback=null` + 诚实原因，避免制造「READY 却 0 行」的谎报态。
   ④ ✅ **审计新增 L4 不变式**：`scripts/verifyDatasetBuildLifecycle.mts` 增 L4「非 READY 且无 RUNNING 作业的版本不得残留数据行」（= 取消即回滚的常驻护栏），**实测 7/7 通过**。
   ⑤ ⬜ **未做**：`completeJob → markReady` 合并单事务（既有已知项）；`batchSize` 速度标定并固化进 `dataset_build_config`。

19. **（闭环运行缺口）界面「运行策略」恒 0 执行 —— 首阻塞 `CL_DATA_NOT_INJECTED` 的真实成因（2026-09-13 02:55 实查登记，**零代码改动**）**：触发 = 用户实报「首阻塞：CL_DATA_NOT_INJECTED」（承接 9ad —— 删掉顶部占位按钮后，运行入口唯一收敛到「运行工作台」页签，用户随即点了「运行策略」）。**一、完整链路（读代码实查，非推断）**：`client/src/pages/StrategyEditor.tsx:989-999` 的 `handleRun` 只送 experimentId / strategyId / strategyVersion / dateRange / executionModel ⇒ `server/researchRunRouter.ts:288-299` 只从入参取 `evaluationInput`(+seed) 与 `lifecycle` 填 `wiringInputs` ⇒ 得 `{}` ⇒ `server/research/closedLoopWiring/executors.ts:187-201` 对 `data` 阶段（需 `via(["researchDataset"])`，同目录 `requirements.ts:66-75`）判定不成立 ⇒ 不注册执行器 ⇒ `server/research/closedLoop/orchestrator.ts:371-385` 门禁 1 发 `CL_DATA_NOT_INJECTED` 且 `firstBlocked = data` ⇒ 其后 13 阶段被 `orchestrator.ts:338-350` 短路为 `CL_UPSTREAM_BLOCKED` ⇒ `overall.status = NO_STAGE_EXECUTED`、`executedStageCount = 0`、`runnerInjected = []`。**二、🔴 结论：当前接线状态下界面运行恒为「执行 0 / 阻塞 14」** ⇒ FE-4/9e 解锁该按钮时所论证的「有诊断价值」实际未兑现（每次诊断结论完全相同）。这是**架构缺口、非代码 bug**；设计侧早有明说 —— `docs/research/RESEARCH-002-report.md:1018` 与 `:1479`：「从 UI 发起的运行在 `data` 阶段必然 `CL_DATA_NOT_INJECTED`（这是如实状态，不是缺陷）」。**三、为何界面补不了**：`closedLoopRunInputSchema`（`shared/researchContracts.ts:730-752`，共 **15 个字段**）**没有 `researchDataset`**；其中的 `datasetVersion` 只是谱系标签（`researchRunRouter.ts:331` 写进 metadata），**不触发任何数据集加载**；`server/researchDatasetRouter.ts:6-8` 明说 rows 百万级、经 RPC 传输不可行 ⇒ **数据必须由服务端解析，不可能由界面传**。**四、修法（已定位，未实施）**：「data 阶段不构建数据集」约束的是**装配层**（`closedLoopWiring` 保持纯函数、零 IO）—— 应由**路由器层**承担解析：`loopRun` 新增 `datasetVersionId` 入参，在 `createClosedLoopWiring` **之前**把版本解析成真实 `ResearchDataset` 并注入 `wiringInputs.researchDataset`，**装配层零改动**。现成零件齐备：`buildResearchDataset`（`server/researchDataset/builder.ts:173`）、`persistResearchDataset`（`persist.ts:54`）、`readRowsStreaming`（`rowsTable.ts:139`，可把已认证数据集读回）、`certify`（`researchDatasetRouter.ts:121`，「创建正式 Dataset 版本」的唯一入口）。**五、🔴 第二道门（勿忘，决定修复顺序）**：即便注入了数据集，`research` 阶段仍要求 `ds.gate === "PASS"`，否则首阻塞只会**推后一格**成 `CL_DATASET_GATE_NOT_PASS`（`orchestrator.ts:411-424`）⇒ 本修复必须排在数据域 G0 认证之后。**六、可顺带做的纯前端改进（零风险）**：结果面板未展示后端**已经算好并回传**的逐阶段缺口 —— `result.wiring.stages[].note` 会直说「缺调用方入参：researchDataset / experimentConfig / strategyContract / strategy13 …」（`server/research/closedLoopWiring/coverage.ts:96-98`），而 `client/src/components/strategy/ClosedLoopRunResultPanel.tsx` 当前只显示编排器的通用 detail（「真实数据链未注入…」）。**七、状态**：🔴 **仅登记，用户裁定「只登记，暂不动代码」**；`server/**`、`client/**` 一行未改、零迁移、零新端点。修法属 `server/**` ⇒ 会 `tsx watch` 热重启并杀死在途研究 Run，**须单独排期**。证据已同步 `.workbuddy/memory/2026-09-13.md` 02:55 条 + `MEMORY.md` 地雷第 14 条。

- **9aq. （LEADER-BACKTEST-STALENESS-001 · 体验补口）回测冷算 20 分钟仍会「阻塞页面」** ⬜ **待做（须排期）**：2026-09-15 已修掉「历史候选池回测结果不随时间更新」的**正确性**缺口（缓存键纳入**数据戳** ⇒ 外部写入也能自愈，详见 `ROADMAP-CHANGELOG.md` 同名条目），但冷算**空载实测 1201.67s**（旧记录 305~413s 已失效）⇒ 数据一变，下一个打开 `/leader-candidates` 的人要**白屏等 20 分钟**（handler 不会被 `server.requestTimeout` 切断 —— 实测 1201s 仍返回 200，该属性只约束「接收请求」阶段）。**正解 = stale-while-revalidate**：数据戳不匹配时**立即返回上一版快照**并带 `stale` / `recomputing` 标记，同时在服务端后台跑重算（复用已加的**单飞**），完成后原子替换快照 ⇒ 页面永不空等。**两条硬约束**：① 标记必须在页面渲染成**显式横幅**（**禁静默显示旧数据**）；② 旧快照要**保留可读**（当前实现「key 不匹配即未命中」，旧文件虽在盘上但读不到）。**同根因家族（一并排期）**：连接池地雷「`maxIdle === connectionLimit` ⇒ `idleTimeout` 是死配置」会让 20 分钟冷算在中途以 `read ECONNRESET` 崩掉（2026-09-15 实遇一次，重灾区 = `loadBacktestPriceRows` 的 1.52M 行查询）；本轮已给该路径加读重试，**根因未修**。

- **9bf. （组合回测页面信息架构重整 · BACKTEST-LAYOUT-001）** ✅ **已完成（2026-09-18）**：承接用户事项「优化组合回测页面」，把 `/backtest` 六个页签的归属重排成「一个总览 + 各归其位」——**① 回测总览** = 「全周期五策略收益对比」+（原属「交易明细」的）「当前持仓与下一交易日准备买入」+「全部模拟订单」，形成「收益 → 持仓 → 订单」自顶向下的一条读线；**② 全部模拟订单新增分页**（前端切片，复用现成 `client/src/components/PaginationBar.tsx`；默认每页 20 笔、可选 10/20/50/100，策略 / 状态 / 原因 / 关键词 / 排序 / 每页条数任一变更即回到第 1 页；**不新增端点、不改任何统计口径** —— 表头「显示 X/Y 笔」仍按筛选后全集计，只有渲染层切片）；**③ 三块迁出**：「统一策略评价（六层）」→ **策略对比**（与样本外拼接曲线 / 泛化稳定性 / 表现归因同屏）、「高位连板风控生效情况」→ **风险归因**、「资金与仓位审计」→ **交易明细**（该页保留一句迁移提示，并把 `data-portfolio-provenance` 浮层由「与『回测总览』的生产引擎段非等价」改为「与『资金与仓位审计』的生产引擎段非等价」，因两者已不在同一页签）。**取证**：`tsc --noEmit` = exit 0；`tests/server/backtestPage.test.ts` 新增**页签归属**断言（按 `data-*` 锚点取所在行的渲染条件，钉死「哪块挂哪个页签」+ 每块仅一个渲染点 + 分页锚点存在）⇒ **3 / 3**；全量 `vitest run` = **8 failed files / 17 failed tests（失败文件集合与基线逐项一致 ⇒ 本轮零新增）**；**无头 Chrome + CDP（真实 `Input.dispatchMouseEvent`）探针** `docs/evidence/_probe_backtest_layout_pagination.mjs` = **PASS 50 / FAIL 0 / SKIP 0 ⇒ ALL PASS**，实测 1029 笔订单：第 1 页 20 行 → 「下一页」2 / 52 且首行不同 → 「最后一页」52 / 52 共 9 行 → 每页条数改 10 ⇒ 回到 1 / 103 且 10 行 → 关键词筛选 ⇒ 回到第 1 页、567 笔、行数 = 页内区间长度；并逐页签断言「该有的在、不该有的不在」（总览三项齐且三块迁出物全无、策略对比有 `data-strategy-evaluation` 无订单表、风险归因有 `data-board-height-impact`、交易明细有 `data-capital-position-audit`）。**用户实报复核（同日 22:42，属实已修）**：用户报「**策略对比下的样式乱了（新加的统一策略评价宽度与其他不一样）**」—— 复核**属实**：迁入时把 `<StrategyEvaluationPanel>` 渲染成 `<main>` 的**直接子节点**，而它**自带的卡片样式里没有页面容器类**（本页其余卡片把 `mx-auto max-w-7xl px-4 pt-5 sm:px-6` 写在自己的 `<section>` 上）⇒ 该卡片**比邻卡宽 48px、且整体左移 24px**。**实测（探针 H2 反事实对照：当场剥掉容器 div 的 class）**：套容器 `[left 304, width 1207]` vs 剥容器 `[left 280, width 1255]`，与用户描述逐项吻合；**修法** = 显式套同一层容器 `<div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6">`。**并把它变成常驻护栏（两层）**：① 探针新增 **H「同屏卡片几何一致性」**（三个页签逐个断言同屏卡片左边距/宽度一致 ±1px；🔴 **必须量卡片本体** —— 锚点优先取 `> .rounded-2xl` 子元素、否则取锚点自身，直接量锚点会得到 280/1255 vs 304/1207 的**假差异**，差的正是那 24px 内边距）+ **H2「反事实对照」**（剥掉容器类必须立即变宽 ⇒ 证明容器类是**承重件**而非装饰）；② `backtestPage.test.ts` 增加源码级断言「`<StrategyEvaluationSection` 所在行必须含 `mx-auto max-w-7xl px-4 pt-5 sm:px-6`」。**复跑 ⇒ PASS 50 / FAIL 0 / SKIP 0（ALL PASS）**，三个页签同屏卡片实测左边距/宽度**全部 = 304 / 1207（±1px）**。**边界**：`client/**` 仅 `pages/Backtest.tsx` 一文件改动 + 1 个新探针 + 1 处测试加固；**零迁移 / 零新表 / 零新端点 / 零新依赖**；`server/**` **一行未改**（不触发 `tsx watch` 热重启 ⇒ 不会杀死在途 Run）；转出三块的口径与文案**逐字未改**（仅位置与 `data-*` 锚点变化）。证据：`docs/evidence/_probe_backtest_layout_pagination.mjs` / `.out.txt`。

- **9bg. （回测总览「各策略回撤与收益特征」区块 · BACKTEST-RISK-BLOCKS-001）** ✅ **已完成（2026-09-18）**：承接用户事项「回测总览页面添加功能」（`rZPX8O`，父事项 `rZ7fMn` 原话「在回测总览全周期五策略收益对比的区域中，折线图下面加入几个区块，用来展示每种策略的最大回撤，回撤持续时间，收复回撤所用时间。以及最大收益百分比，当前收益百分比」）⇒ 在「回测总览 → 全周期五策略收益对比」折线图**下方**新增 **5 张策略卡片**，逐策略给出**最大回撤 / 回撤持续时间 / 收复回撤所用时间 / 最大收益 / 当前收益**（收益按红涨绿跌着色，卡片脚注回显「最大收益日 / 期末日」）。**① 口径（关键：不新造第二套回撤算法）**：最大回撤取 `realisticSimulation.maxDrawdown`（`server/realisticBacktest.ts` 以**初始资金**为起点对整条权益曲线取峰谷）；回撤持续时间 / 收复回撤所用时间取 `strategyEvaluation.stability.maxDrawdownDurationTradingDays` / `longestRecoveryTradingDays`（`server/downsideRisk.ts#calculateDrawdownDurations`，= **全期最长的一次**回撤区间；前者「从进入回撤到创出新高或期末」、后者「从回撤开始到恢复前高或未恢复至期末」），**只在展示层搬运** ⇒ 与「策略对比 → 六层评价」里的同名指标**天然同源**；收益两项由新增纯函数模块 `client/src/lib/fullCycleRiskBlocks.ts` 从**该策略自身完整权益曲线**恒等派生（最大收益 = 曲线最高点相对初始资金，**并列时取最早**以保证渲染稳定；当前收益 = 期末权益相对初始资金，数值上等于 `totalReturn`）—— 🔴 **不按图表起始日裁剪曲线**，与服务端 `maxDrawdown` / `stability` 的计算范围保持一致；曲线中的非有限值/非正权益点一律剔除，**初始资金非正或曲线无有效点时返回全空 ⇒ 展示「样本不足」**（**禁 0 或上一笔权益兜底**）。**② 落点与锚点**：区块渲染在 `data-full-cycle-comparison` 卡片**内部**（与折线图同卡，因此**不需要**另套页面容器类），锚点 `data-full-cycle-risk-blocks`（区块本体，挂在页面主 JSX 行上以保留页签归属断言）与 `data-full-cycle-risk-card={<key>}`（每张策略卡，**禁**用会被 `…-blocks` 吞掉的裸子串形态），渲染点唯一。**③ 验收（四层全绿）**：`tsc --noEmit` = **exit 0**；新增 `tests/client/src/lib/fullCycleRiskBlocks.test.ts` **8 / 8**（含「并列最高点取最早」「非法点剔除且不当期末点」「初始资金 ≤0 / 空曲线 ⇒ 全空降级」「回撤三项原样搬运不重算」「不把整条权益曲线带进渲染数据」）；`tests/server/backtestPage.test.ts` 增补区块文案与锚点断言 + **页签归属**（按锚点取所在行 ⇒ 必须 `activeTab === "overview"`）+ 渲染点唯一 ⇒ **3 / 3**；**无头 Chrome + CDP 探针** `docs/evidence/_probe_full_cycle_risk_blocks.mjs` = **PASS 37 / FAIL 0 / SKIP 0 ⇒ ALL PASS**，其中 **D 段口径交叉核对 20 / 20 全绿**（5 策略 × 4 项，区块值与「策略对比 → 六层评价」同一策略列的 Max Drawdown / 最大回撤持续时间 / 最长恢复时间 / Total Return **逐个数值相等**，实测原始策略 `40.39% / 68 个交易日 / 68 个交易日 / 364.2%`、质量门控 `59.42% / 154 / 153 / 60.85%`）+ E 段几何（5 张卡同排**等宽 223px × 5、同一 top**，行左边缘/宽度与折线图**逐像素对齐** 325 / 1165，且不越出所属卡片 `[280,1535]`）⇒ 证明新区块与折线图同宽同左、无「风格乱了」那类错位。**④ 边界**：**纯 `client/**` 改动**（+1 lib / +1 测试 / +1 探针）⇒ **零 `server/**` 改动、不触发热重启、不杀在途 Run**；零迁移 / 零新表 / 零新依赖 / 零新端点；**未部署新 MCP、未改任何统计口径**。**⑤ 口径待用户裁定的唯一空间**：「回撤持续时间 / 收复回撤所用时间」当前取**全期最长的那一次回撤区间**（与「策略对比 → 六层评价」逐字一致）；若用户要的是「**最大回撤那一次**区间的持续与收复用时」，则需在 `server/downsideRisk.ts#calculateDrawdownDurations` 改取区间策略（**改 server ⇒ 必须排在无在途 Run 的时段**），展示层与派生模块均无需改动 —— 本轮**按前者交付**，理由是同名指标在整个系统内只能有一套口径。 🔁 **口径修订（2026-09-18，见 §44.5 `9bh`）**：用户已裁定改为「**最大回撤那一次**」区间 —— 回撤持续 = **峰值日→谷底日**、收复用时 = **谷底日→收复前高**（未收复计至期末）。上文 ① 与 ⑤ 中「全期最长的一次 / 全期最长的那一次」的表述**已作废**（实测原始策略由 `68 / 68` 变为 `19 / 16`）；六层评价标签「最长恢复时间」同时更名为「**最大回撤恢复时间**」。
- **9bh. （回撤时长口径修订：改取「最大回撤那一次」区间 · DRAWDOWN-DURATION-REBASELINE-001）** ✅ **已完成（2026-09-18）**：承接用户对 `9bg` 遗留项的直接裁定「**先改成「最大回撤那一次区间的持续与收复用时」**」⇒ 把 `server/downsideRisk.ts#calculateDrawdownDurations` 的**取区间策略**从「全期各区间**分别**取最大」改为「**锁定最深那一次**回撤区间，两个指标取自**同一**区间」。**① 口径（用户二选一已裁定）**：回撤持续时间 = **峰值日 → 谷底日**的交易日数；收复回撤所用时间 = **谷底日 → 收复前高**的交易日数（未收复则计至期末）⇒ 二者相加**恒等于**「峰值日 → 收复日」总时长（🔴 有单测钉死该恒等式）；并列最深时取**最早**那一次；空序列 / 全期无回撤 ⇒ 两项皆 `null`。**② 为什么这是一次真修复**：旧实现两个数字**可能来自不同区间**（实测质量门控 `154 / 153`），且在已收复的区间上「持续」与「收复用时」**恒等**（`68 / 68`）⇒ 卡片上两个字段看起来重复、又不锚定最大回撤。新口径下原始策略从 `68 / 68` 变为 **`19 / 16`**（Σ=35），正是「**最深那次 ≠ 最长那次**」的直接证明。**③ 同步改动（4 处，缺一不可）**：⒜ `server/downsideRisk.ts` 重写 `calculateDrawdownDurations` 并 **export**（为单测）；⒝ `client/src/components/StrategyEvaluationPanel.tsx` 六层评价第四层 —— 定义文案改写，并把标签「**最长恢复时间**」→「**最大回撤恢复时间**」（旧标签在新口径下已是**错误命名**）；⒞ `client/src/lib/fullCycleRiskBlocks.ts` 与 `client/src/pages/Backtest.tsx` 的口径注释 + 区块说明文案；⒟ `tests/server/backtestPage.test.ts` 标签断言。**④ 边界（关键）**：改为 `server/**` ⇒ 🔴 **动 server 前先跑在途 Run 闸门**（`docs/evidence/_probe_inflight_runs.mts`）：实测 23 张含 `status` 表里仅 `research_question:270001` 为 `RUNNING`，时间戳停在 **2026-09-17T06:50:58Z（约 32 小时前）⇒ 历史僵死**；真正的 Run 载体表（`closed_loop_backtest_run` / `research_run(s)` / `paper_trading_runs` / `dataset_build_job`）**全为 0** ⇒ 可安全热重启。🔴 **已核**：`DownsideRiskStrategyEvaluation.stability` 在**服务端无任何其它消费者**（`server/research/strategyEvaluation/` 是**另一个模块**，同名不同物）⇒ 本改**不影响任何评分 / 门控 / 排名**，只影响两处展示与探针。字段名**一律沿用旧名**（`longestRecoveryTradingDays` 不再表示「全期最长恢复」）以避免跨端 schema 改名，语义以函数注释为准。**⑤ 验收（四层全绿）**：`tsc --noEmit` = **exit 0**（⚠️ 本机 `node_modules/.bin/tsc` 的 shim 需要 `sed`/`dirname`，在缺 coreutils 的 Bash 里会 `MODULE_NOT_FOUND` ⇒ 改直接调 `node node_modules/typescript/bin/tsc`，vitest 同理走 `node node_modules/vitest/vitest.mjs`）；新增 `tests/server/downsideRiskDrawdownDurations.test.ts` **8 / 8**（含「锁定最深而非最长」「二者相加 = 峰→收复」「并列取最早」「期末未收复计至期末」「空 / 单点 / 无回撤 ⇒ null」）；`tests/server/backtestPage.test.ts` **3 / 3** + `tests/client/src/lib/fullCycleRiskBlocks.test.ts` **8 / 8**⇒ 三文件合计 **19 / 19**；**无头 Chrome + CDP 探针** `_probe_full_cycle_risk_blocks.mjs` 重跑 = **PASS 37 / FAIL 0 / SKIP 0 ⇒ ALL PASS**，其中 **D 段与六层评价数值交叉核对 20 / 20 仍全绿**（两侧同源 ⇒ 交叉核对在改口径后**依然成立**，这正是在同一处改口径而不是在展示层另算的价值），E 段几何**无回归**（5 卡等宽 `223px × 5`、行左 `325` = 折线图左 `325`、行宽 `1165` = 折线图宽 `1165`、区块 top `932` 在折线图 top `485` 下方 `447px`）。**⑥ 实测数值（新口径）**：原始策略 `40.39% / 19 / 16 / +364.2%`、风险扣分策略 `37.61% / 27 / 41 / +665.54%`、高风险硬过滤 `38.46% / 27 / 41 / +367.26%`、质量复合评分 `37.56% / 27 / 49 / +668.84%`、质量门控策略 `59.42% / 111 / 43 / +60.85%` —— 其中质量门控 `111 + 43 = 154` **恰等于**旧「最长」口径的 `154`，说明该策略的最深回撤与最长回撤是同一次，两套口径在它身上自洽收敛。**⑦ 未做**：未部署新 MCP；零迁移 / 零新表 / 零新依赖 / 零新端点；**未提交 git**（工作区另含前几轮 `9bd` / `9be` / `9bf` 的未提交改动）。

- **9bj. （LADDER-HEIGHT-CALIBER-001 · 连板梯队「高度」口径修正：改取「若本日涨停会达到的连板数」· 事项 `rKRNzQ`）** ✅ **已完成（2026-09-18）**：承接用户对 `9bi` 遗留 a) 的直接裁定 —— 用户原话「连板高度口径差 1 板，这个应该是代表加入今天涨停的话的高度，**而不是N天M板的M**」⇒ ① 推翻上一轮的口径归因（「附件源用 **N天M板 累计口径**」的说法**作废**）；② 明确附件那 1 板的真实含义 = **「若该股本日涨停，会达到的连板数」**。**① 先取证再动手（关键）**：新增只读探针 `docs/evidence/_probe_ladder_height_caliber.mts`（直连库）把「数据缺口造成假差 1」与「真口径差」分开 —— ⒜ **逐只打印连板链**：澳弘电子 `605058.SH` 在 `limit_up_records` 里恰为 **09-11 / 09-14 / 09-15 / 09-16 / 09-17**（09-12 / 09-13 为周末，链**无断档**）⇒ 本算法 5 板**没有算错**，附件 6 板也**不是**数据缺口；⒝ **与库内 vendor 字段 `boardCount` 对拍不成立** —— 该列在窗口内 **952 行不一致**，逐行看是**基本全 NULL**（只在「首板」那行填 `1`，`2` 板起全空）⇒ **不是可用真源**（与既有结论「`boardCount` 是死字段」一致）；⒞ **断板股逐只对拍**：澳弘电子 **5→6**、中晶科技 **3→4**、共达电声 / 中岩大地 / 万向德农 **2→3**；当日涨停股 华瓷股份 / 锡华科技 **4→4**、世联行 / 内蒙新华 **3→3** ⇒ **断板 +1、涨停 +0**，规则唯一。**② 附件图的第二条证据（上一轮漏看）**：附件 2 板行是**完整可见的 8 格且零删除线**（全是当日 2 板股）⇒ 参考工具**不把「首板未续」并入 2 板行**，故 `brokenKind === "first"` **不 +1**（那 30 只继续留在「首板(N)」组末尾，与本页既有行为一致）。**③ 实现落点（受架构约束）**：🔴 `client/**` **禁止 import `server/**` 运行时值** ⇒ 口径函数不能放 `server/boardRoster.ts`，新建 **`shared/ladderHeight.ts`**（唯一实现，`ladderHeight({ boards, brokenKind })`：`connection` ⇒ `boards + 1`，其余原样）+ **`tests/shared/ladderHeight.test.ts`**（4 例：涨停不 +1 / 连板中断 +1 / 首板未续不 +1 / 2026-09-18 逐只对拍）。首页 `BoardLadderSection` 的分组上界与成员过滤**全部改走 `ladderHeight`**（原按 `row.boards`），并向 `CardDescription`、`BoardLadderSection` 注释与文件头补写新口径（**免责声明不得删**：改成「高度 = 若该股本日涨停会达到的连板数」）。⚠️ **未改** `server/boardRoster.ts` 的 `boards` 语义与 `metrics.maxBoards`（= 当日**已实现**最高连板数 4，喂 `shared/boardEmotionScore` 情绪评分）⇒ 梯队左列最高值（6 板）**可以高于** `metrics.maxBoards`，属**口径不同而非冲突**，已在两处注释中标明。**④ 验收（四层全绿）**：`tsc --noEmit` = **exit 0**；新增单测 **4/4**；全量 `vitest run` = **8 failed files / 17 failed tests = 基线，零新增**（失败文件集合逐项一致；总计 258 文件 / 250 passed）；行尾哨兵 `node scripts/checkEolDrift.mjs` = **0 漂移**；**无头 Chrome + CDP 探针** `_probe_homepage_rework.mjs` 重跑 = **PASS 35 / FAIL 0 / SKIP 0**（较上轮 **+2** 条新增断言：⒜ 九只指定个股**逐只**落在期望高度行 —— 澳弘电子 6 板 / 中晶科技 4 板 / 共达电声·中岩大地·万向德农 3 板 / 华瓷股份·锡华科技 4 板 / 世联行·内蒙新华 3 板；⒝ 2 板行**只含**当日 2 板股、零删除线 ⇒ 证明「首板未续不并入」；数据日 ≠ 2026-09-18 时该组断言自动 SKIP，避免探针随数据累积变成假失败）。**实测分组结构（与附件图逐格同构）**：`6 板(1 格) / 4 板(3 格) / 3 板(5 格) / 2 板(8 格) / 首板(66)(96 格)`，上轮为 `5 板(1) / 4 板(3) / 3 板(5) / 2 板(11)`。**⑤ 边界**：**纯 `client/**` + `shared/**` + `tests/**` 改动 ⇒ 零 `server/**` 改动、不触发热重启、不杀在途 Run**（动手前已跑在途闸门 `docs/evidence/_probe_inflight_runs.mts`：唯一 `RUNNING` = `research_question:270001`，时间戳停 **2026-09-17T06:50:58Z（约 1 天前）⇒ 历史僵死**；`research_run` / `research_runs` 等 Run 载体全 0）；零迁移 / 零新表 / 零新依赖 / 零新端点；未改任何库内数据。**⑥ 仍未做（交用户定）**：⒜ 附件图**行内排序**与本文不同（附件把断板格排在行首，本页按「封板时间升序 ⇒ 无时间者（断板）排末」；附件自身也不一致 —— 4 板行断板在前、3 板行断板在后）⇒ 未擅改；⒝ `limit_up_records` 的 **2026-09-16 两条名称错录**（`001216.SZ`→「华统股份」、`603248.SH`→「镌华科技」）仍在，**本轮探针再次撞上**（按名称查 09-16 会漏这两只，按代码不受影响）⇒ 建议重录；⒞ 首板未续是否也按「若本日涨停」并入 2 板行（严格套用该口径）—— 开关只有一处：把 `shared/ladderHeight.ts` 改成 `row.boards + 1`（不分 `brokenKind`）即可，本轮**按附件图**保持不并入。**⑦ 工具教训（真踩）**：🔴 **对同一文件并行发多个 `Edit` 会静默丢改动** —— 本轮把「加 import」与「改分组」两笔 Edit 并行发往 `client/src/pages/Dashboard.tsx`，import 那笔被后写覆盖（两笔各自都报成功，靠 `tsc` 的 `TS2304 Cannot find name` 才暴露）⇒ **同一文件的多次修改必须串行**，且改完必须 `grep` 回读复核。已写入 `.workbuddy/memory/PROJECT_RULES.md`。详见 `docs/evidence/README.md` `homepagerework` 节。 🔁 **2026-09-19 用户裁定（并入 §44.5 `9bk`）**：⑥⒞ 已定 —— **「首板未续」也要 +1**（本轮原「按附件图保持不并入」作废，判据见 `9bk` ①：附件 2 板行那 8 格只是 38 格的子集）；⑥⒜ 亦已定 —— 行内排序改为**按题材当日热力、无关是否断板**（附件「断板排首」不再参照）。
- **9bk. （HOMEPAGE-003 · 首页第三轮：连板高度「首板未续 +1」+ 梯队默认折叠 + 行内与热力图改按题材当日热力排序 · 事项 `rKRNzQ`）** ✅ **已完成（2026-09-19）**：用户原话「「首板未续」也要+1，如果行数超过三行加个折叠按钮且默认折叠。行内排序按题材当日热力排序，无关是否断板。题材热力中排序规则按当日数据而不是按合计」⇒ 四条一次落地。**① 首板未续 +1**：`shared/ladderHeight.ts` 改为 `brokenKind ? boards + 1 : boards`（唯一实现；单测补「首板未续 ⇒ 2 板」与「口径唯一：不分 `brokenKind`」两例）⇒ **30 只首板未续从「首板(66)」行上移到 2 板行**（断板格形态），首板行只剩当日首板 66 只。⚠️ 上一轮「不 +1」的依据（附件 2 板行 8 格零删除线）**作废** —— 那 8 格只是 38 格的**子集**，**子集可见 ≠ 全集不含断板**（本条最有价值的认知修正，已写入 `shared/ladderHeight.ts` 注释）。**② 默认折叠**：`LADDER_VISIBLE_ROWS = 3`，行数 > 3 出现 `data-homepage-ladder-toggle`（`aria-expanded`），实测默认 `visible=3 / total=5 / renderedRows=3`，展开后 `5/5` 且文案转「收起」；折叠态整页高 **3983 → 2886px**。**③ 行内按题材当日热力排序**：新增 `shared/sectorHeatOrder.ts`（`sectorHeatOf` 缺热度取 **-1**，必须低于「当日 0 家」的真值 0）+ `tests/shared/sectorHeatOrder.test.ts`（4 例）；梯队行内改为「题材当日涨停家数降序 → 封板时间升序 → 代码」，`buildItems(up, cut)` 合并后**统一排序**，删除原 `[...up, ...cut]` 拼接（即断了「断板恒排末」）⇒ 实测交错行 `4 板 / 3 板 / 2 板`。**④ 热力图按当日排序**：排序键由窗口合计改为 `days[0]`（最新一列）当日家数，合计退为次键、取前 20 随之。**数据源复用**：两者均用既有 `limitUp.getSectorDistribution`（**零新端点、零新查询**；与热力日历同一 query key ⇒ 共用缓存）。**验收**：`tsc` = 0；新增单测 **9/9**；全量 **8 failed files / 17 failed tests = 基线零新增**（259 文件 / 251 passed）；行尾 **0 漂移**；CDP 探针 **PASS 47 / FAIL 0 / SKIP 0**（较上轮 +12：F 折叠默认态/展开态 6 条、G 行内热度非递增 + 断板交错 + 热力图当日列 = 服务端真值且非递增 5 条、H 2 板行含断板 + 首板行零断板 2 条）。**边界**：纯 `client/**` + `shared/**` + `tests/**` ⇒ 零 `server/**` 改动、不热重启、不杀在途 Run；零迁移 / 零新表 / 零新依赖 / 零新端点；未改库内数据。**遗留**：`limit_up_records` 2026-09-16 两条名称错录仍待重录。详见 `docs/evidence/README.md` `homepagerework` 节。
- **9bl. （HOMEPAGE-004 · 首页第四轮：梯队折叠口径修正为「组内」· 事项 `rKRNzQ`）** ✅ **已完成（2026-09-19）**：用户澄清原话「之前说的超过三行折叠是每个高度内超过三行折叠那个高度到只有三行」⇒ **推翻 `9bk` 的「整梯队高度行折叠」实现**。**交付**：`client/src/pages/Dashboard.tsx` 新增 `LadderGroupGrid`（每组独立展开态）+ `useGridColumnCount`（`ResizeObserver` + `getComputedStyle().gridTemplateColumns` token 数 ⇒ 折叠换算「3 行 = 3 × 当前列数 格」，2/3/4/6 列各断点下都恰好 3 行）；`LADDER_VISIBLE_ROWS` → `LADDER_GROUP_VISIBLE_ROWS`；旧锚点 `data-homepage-ladder-toggle` / `data-homepage-ladder-rows-total/-visible` 移除，新锚点 `data-ladder-grid` / `data-ladder-grid-rows-total/-visible` + 按钮 `data-homepage-ladder-group-toggle`；**整个梯队的高度行恢复全量渲染**。**顺手修**：卡片描述中**被原样渲染的 Markdown `**`**（JSX 正文不吃 Markdown）清掉 4 处。**验收**：`tsc` = 0；全量 `vitest run` = **8 failed files / 17 failed tests = 基线零新增**（259 文件 / 251 passed）；行尾 **0 漂移**；CDP 探针 **PASS 48 / FAIL 0 / SKIP 0**（F 节由 6 条扩到 7 条：新增「只点某组 ⇒ 仅该组展开」「整个梯队高度行不再整体收起」「行数 ≤ 3 的组无按钮」）。**边界**：纯 `client/**` ⇒ 零 `server/**` 改动、不热重启；零迁移 / 零新表 / 零新依赖 / 零新端点。**认知（复用价值高）**：**「行」在响应式网格里必须先换算成「格」**（列数取计算样式，不写死、也不另立断点表），否则断点一变折叠就名不副实。**`9bk` 遗留了结**：2026-09-16 名称错录由**用户自行处理，本项目不再跟踪**。详见 `docs/evidence/README.md` `homepagerework` 节。
- **9br. （BACKTEST-002 收尾二 · B-04 收口 + R-02 schema + B-03 真实 Run + R-04 zero-volume）** ✅ **完成（2026-09-19）**：**B-04 COMPLETE**（年化基数统一 252 + 复用共享原语 + `maxDrawdownPct` 符号纠正 + 收益率算式形式统一；闭环 evaluation 的重叠标量取 canonical，真实链路 `metricsSource="canonical"`）；**R-02 COMPLETE**（`fixed-amount` 进 Strategy Schema，缺/非法金额一律响亮拒绝）；**B-03 COMPLETE**（真实 Run → `resultJson.backtest`，只读复核 20 项全绿、`failures=0`；两次独立运行指纹逐字节相同）；**R-04 COMPLETE**（zero-volume 三执行模型端到端）；**R-05 修复**（留档写入改有界重试，修掉「长运行静默丢档」）。⚠️ **R-06（新，中）**：单次真实 Run 593~627 s（ARCH-002 前 14.3 s）⇒ **PARAMETER-001 前必须先 profile**（Core 只占 8.7%，主因未定位）。报告 = `docs/research/BACKTEST-002-IMPLEMENTATION-REPORT.md`。
- **9bq. （BACKTEST-002 收尾 · B-03 持久化 + canonical Metrics）** ⚠️ **部分完成（2026-09-19）**：**B-03 COMPLETE**（artifact 传播打通：`loopRun` 解构 `artifacts`；`resultJson.backtest` 有界载荷 + 两个全量指纹 + 政策版本，零 schema 变更）；**B-04 PARTIAL**（canonical 唯一实现已建并进载荷，evaluation 阶段未改 ⇒ 需先决策年化基数 244 vs 252）。R-03（`fixed-amount` 仓位变体未加进文档 schema）未做。新增 `tests/server/backtest/backtestPersistence.test.ts`（10 用例）。报告 = `docs/research/BACKTEST-002-IMPLEMENTATION-REPORT.md`。
- **9bp. （BACKTEST-002 · 执行正确性与结果持久化）** ⚠️ **部分完成（2026-09-19）**：B-01 COMPLETE（政策版本 v1）/ **B-02 COMPLETE（仓位口径真正参与成交预算，执行层测试证明参数敏感性 0.3→0.6 生效）** / B-05 COMPLETE（零成交量不可成交）；**B-03 / B-04 未完成**（结果未入 `resultJson`、两套 Metrics 未统一）⇒ 判定 NOT COMPLETE。新增 `tests/server/backtest/positionSizingExecution.test.ts`（15 用例）。报告 = `docs/research/BACKTEST-002-IMPLEMENTATION-REPORT.md`。
- **9bo. （BACKTEST-001 · Backtest Core 补齐与生产接线）** ⚠️ **部分完成（2026-09-19）**：Phase A 证实 `server/backtest/**` 即 Core（未新建平行目录）；补 `context.ts`（执行政策 G1 / 语义校验 G3 / 仓位映射 G2 / OrderIntent）与 `backtestResult.ts`（BacktestRunResult / 指标 / §23 有界载荷）+ 19 用例；生产装配改为**显式传** `executionRules`（⚠️ 涨跌停拦截由关转开 = 行为变更）。未完成：§29 C/D/E/H/K/L 未新增对照、§30 Legacy 对比未做、`positionSizing` 仍未被执行（B-02）、载荷未接留档（B-03）。报告 = `docs/research/BACKTEST-001-IMPLEMENTATION-REPORT.md`。
- **9bn. （STRATEGY-ARCH-002 · Strategy Core 生产接线与运行留档）** ✅ **已完成（2026-09-19）**：策略判定切换到 `StrategyRuntime.evaluate`（唯一执行入口，接线点 = STEP 10 既有注入槽 `Strategy13.signalBuilder`）；新增 `server/strategyCore/production/**`（barWindow 锚定 / 事件判定器 / Core 决策源 / 文档→版本 / Run Record）；运行留档写进既有 `closed_loop_backtest_run.resultJson.strategyRun`（**DB Schema 变更 = 0**）；新增 46 个生产层测试。剩余项 N-03/N-04 仍在，新增 N-05~N-08（逐决策坐标 / 数据集视界 / 事件源声明 / 首板性）。报告 = `docs/research/STRATEGY-ARCH-002-IMPLEMENTATION-REPORT.md`。
- **9bu. （HOMEPAGE-006 · 首页底部四个快捷入口卡片整体移除 · 用户口述）** ✅ **已完成（2026-09-19）**：用户原话「现在首页最下面有四个大的跳转按钮没用 去掉」⇒ 一处页面改动，**零 `server/**` 改动**（用户在用页面，按三门第 1 条只走 `client/**` HMR）。**① 删渲染块 + 常量**：`client/src/pages/Dashboard.tsx` 删 `SHORTCUTS` 常量（4 条 = 涨停复盘明细 / 大盘分析 / 情绪分析 / 上传图片）+ 其 `Link` 卡片网格渲染块（`md:grid-cols-2 lg:grid-cols-4`），区块注释由「⑤ 快捷入口 + 免责声明」改为「⑤ 免责声明」；同时删已无引用的 `import { Link } from "wouter"`（`Card*` 系列仍被其余 17 处引用，**不动**）。**② 验收（无头 Chrome + CDP 真机量 DOM，项目范式）**：`docs/evidence/_probe_homepage_rework.mjs` 原断言「快捷入口 4 个」**改写为反证断言**（`links=0 && cards=0`，改回即红）；对实跑 dev server 执行 **PASS 54 / FAIL 0 / SKIP 0 ⇒ ALL PASS**（新断言实测 `{"links":0,"cards":0}`），A/B/C/D/E/F/G/I 与零回归（热力表「合计」列 / 免责声明 / 标题「行情总览」/ 无残留骨架屏）全部保持。**③ 判据**：`node node_modules/typescript/bin/tsc --noEmit` = **23 条错误、集合与基线逐字一致**（全在 parameterSearch / searchRobustness 在研区，`client/**` 零新增）；`pnpm run test:changed` = **8 失败文件 / 17 例**，失败**文件集合**与基线逐字一致（7 环境依赖 + `parameterSearchEffectiveness`）⇒ 零新增失败；`node scripts/checkEolDrift.mjs` = 0 漂移。**④ 未动**：四个路由本身与侧栏入口（`/limit-up`、`/market`、`/sentiment-analysis`、`/upload`）**保持可达**，本轮只摘掉首页的重复入口。**⑤ 顺带对账**：编号台账两处同步 `9br` → `9bu`（`9bs`/`9bt` 已实占见台账行说明）。
- **9bm. （HOMEPAGE-005 · 首页入口改为「点击左上角网站标题」· 用户口述）** ✅ **已完成（2026-09-19）**：用户原话「首页做成点击左上角网站标题访问，不要单独有一栏在复盘分析下面」⇒ 一处壳层改动，**零页面代码改动**（`Dashboard.tsx` 未动）。**① 删侧栏项**：`client/src/components/AppShell.tsx#navGroups` 中「复盘分析」组首的「首页」项移除，随之空转的 `LayoutDashboard` import 一并删；`isPathActive` 对 `/` 的 `currentPath === "/"` 分支**保留**（该函数是全局分段匹配的唯一实现，不能因少了一个菜单项就退化）。**② 标题即入口**：`SidebarHeader` 的 `涨停复盘助手` 按钮**原本已 `onClick -> "/"`**（即「能回首页」这件事此前就成立，只是没人知道），本轮补齐的是**用户够不够得到 + 探针量不量得到**：`type="button"`、`title` / `aria-label` = 「返回首页」、**显式 `cursor-pointer`**（Tailwind v4 preflight **不再**给 `button` 默认手型 ⇒ 不写就没有可点击感）、`focus-visible:ring-2`，并加稳定锚点 `data-slot="sidebar-home-link"`。**③ 探针同步（含两处存量纠错）**：`docs/evidence/_probe_sidebar_active_highlight.mjs` 的 `ROUTES` 把**过期的** `['/', '涨停复盘']` 改为 `['/limit-up', '涨停复盘']`（HOMEPAGE-001 起 `/` 就不是涨停复盘明细页，旧断言早已不成立）、补登漏掉的 `/research/ask`；新增 **5/6 段**（首页侧栏无高亮 / 侧栏确无「首页」项 / 标题按钮文案·提示·手型光标三合一）与 **6/6 段**（从 `/strategies` 点标题 ⇒ `path=/` 且零高亮）。**验收**：`tsc --noEmit` = 0；全量 `vitest run` = **8 failed files / 17 failed tests = 基线，零新增**；探针 **PASS 37 / FAIL 0 / SKIP 0**（32 → 37 条）。**边界**：纯 `client/**`（+ 一个探针文件）⇒ 零 `server/**` 改动、不热重启、不杀在途 Run（动手前跑在途闸门）；零迁移 / 零新表 / 零新依赖 / 零新端点。**认知（复用价值高）**：**「路由」与「入口载体」是两件事** —— 删掉导航项**不需要**动路由，但**必须同步**「站在这条路由上，侧栏有没有东西该亮」的断言，否则探针会立刻在 `/` 上假失败（本轮实测正是如此：改完即报 `FAIL / 期望唯一高亮=[涨停复盘] 实际=[]`，根因是断言本身过期而非代码错）。**工具坑复现**：同一条消息里发**两个** `Edit` 改**同一文件** ⇒ 后写覆盖先写、前者**静默丢失**（本轮 `ROUTES` 的 `/` → `/limit-up` 就被吞掉，靠复跑探针才发现）。**同一文件的多处修改必须串行。**


- **9bd. （RESEARCH-ORPHAN-RECLAIM-002 · 回收死角）孤儿 `RUNNING` Run 的第三种形态：父 Run `RUNNING` + 子分析全终态 + 有结果 —— 自动回收看不见** ⬜ **待做（2026-09-18 实查登记）**：**触发 = 用户要求排查「库里那个 `RUNNING` 的 Run」**。**一、现场（实测）**：`research_run 930001`（experiment 660001）`status=RUNNING`、`startedAt=2026-09-17T14:51:06Z`，而它名下 **28 条分析全部 COMPLETED**、`research_result` **510 行**、`executionLogJson` 批次 1 停在 `RUNNING` / `completedAt=null` —— 即「**活全干完了，只有 Run 的收尾没写**」（推断成因 = 收尾瞬间被 `tsx watch` 热重启杀死；**实测证据** = 当前 dev 进程启动时间晚于该 Run 的 `startedAt`，且无任何子分析在途）。**二、🔴 缺口定位（读码 + 零写入实证）**：`server/researchEngine/reclaim.ts` 的 `RUNNING` 兜底分支（④）**是在遍历 `looseAnalyses`（= PENDING/RUNNING 的分析）时才把父 Run 收进 `orphanedRuns`** ⇒ **子分析全部终态的形态永远进不了视野**。取证手法（可复用）：把真实仓储包成「写即抛错」的 Proxy 后调用**真实** `reclaimOrphanResearchWork()` ⇒ 实测 `reclaimedRuns: []`、`writeAttempts: []`（确实零写入）、只如实回报「保留未执行草稿 `630002`」（`docs/evidence/_probe_reclaim_blindspot.mts`）。**三、影响**：`run()` 要求 `PENDING|FAILED|CANCELLED`、`runIncremental` 要求非 `RUNNING` ⇒ 该实验在 UI 恒显「执行中」且**无产品级恢复入口**（与 2026-09-11 事故同构）；`inFlightRunCount` 虚高还会让一切「在途保护」判据误判。**四、本轮处置（用户授权 · 已执行）**：按 2026-09-12 收敛 `330003` 的**既有 `RUN_ORPHANED` 口径**人工收敛（`docs/evidence/_ops_converge_orphan_run_930001.mts`）：`FAILED` + `errorCode=RUN_ORPHANED` + `completedAt` **取日志内最后活动时间戳 `2026-09-17T14:52:28Z`（非 `NOW()`）** + 末批日志同步收敛 + Experiment 660001 回滚 `FAILED`；28 条分析 / 510 行结果**原样保留**。收敛后 `RUNNING` 计数 = **0**。**五、待做（本条目）**：把回收器的**遍历入口**从「非终态分析」改为「所有非终态 Run（含子分析全终态者）」，判据沿用 `startedAt` 停更 > `DEFAULT_STALE_RUNNING_MINUTES`(720) —— 落地后本形态即可自动收敛；**验收应含**：① 该形态被收敛；② 父 `PENDING` 草稿仍**一律不动**（`630002` 回归用例）；③ 父 `RUNNING` 且**仍有在途子分析**时不得误判（保守，避免与真实执行者竞争）；④ 幂等。**边界**：属 `server/**` 改动 ⇒ 会热重启并杀死在途 Run，**须排在无在途 Run 的时段**；本轮**零代码改动**、零迁移、零新依赖。

- **9be. （HOMEPAGE-001 · 行情复盘总览首页）** ✅ **已完成（2026-09-18）**：`/` 已由「涨停复盘明细」换为**行情复盘总览首页**，原明细迁 `/limit-up`。**触发** = 用户「我需要加一个首页」；**同日追加 5 条版式要求**（见「二」），且用户明确「这个任务是承接上面的任务，不是在现有页面里添加」⇒ 5 条要求**全部落在新首页**，**现有 `/market` 大盘分析页零改动**（本轮曾误改该页为「5 区块版式」，已用 `git cat-file -p HEAD:client/src/pages/Market.tsx` 逐字节还原并**重施其原有那 5 行白屏修复** ⇒ `git diff --numstat` 回到 `+5/-1` / 纯 LF / 与改前一致）。**一、路由与导航（全部 `client/**`）**：① 新增 `client/src/pages/Dashboard.tsx`（新首页）；② `client/src/pages/Home.tsx` 经 `git mv` 改名 `LimitUpReview.tsx`（内容零改）；③ `App.tsx`：`<Route path="/" component={Dashboard}>` + 新增 `<Route path="/limit-up" component={LimitUpReview}>`；④ `AppShell.tsx`「复盘分析」组首项 = 「首页」`/`（icon `LayoutDashboard`），其后新增「涨停复盘」`/limit-up`（icon `Flame`）；⑤ `Upload.tsx` 改用 `<Button asChild><Link href="/limit-up">查看全部数据</Link></Button>`（顺修 `<Link><Button>` 非法嵌套）。**侧栏高亮零改动** —— `AppShell.tsx#isPathActive` 对 `target === "/"` 已特判「只匹配自身」，`/` 与 `/limit-up` 天然互斥（**禁退回 `startsWith`**）。**二、用户 5 条版式要求（本轮实现口径）**：**① 不展示数据新鲜度条** ⇒ 首页**完全不渲染**「最近复盘日 / 行情最新日 / 待补交易日 / 市场数据缺 / 市场数据最新」，实测这 5 类文案在 `/` 的 `innerText` 中**均不存在**（断言 `freshnessTextsAbsent` PASS）；🔴 原方案里的 **「A 数据新鲜度细条（`market.getSyncStatus`，60s 轮询）」就此作废**（与第 1 条要求直接冲突）。**② 新增大盘日线走势图** ⇒ 「大盘日线走势图」区块，数据 = 新端点 `market.getIndexDailySeries`（基准 `000001.SH` 上证收盘 + `MA5`/`MA20`；`movingAverage` 不足 N 日或含空值返回 `null`、**不插值**）。**③ 大盘成交量 / 两融 / 涨停数 三项整合进同一图表** ⇒ **单个** `ComposedChart`：柱 = 涨停家数（左轴），两条线 = 成交额、两融余额（**各自独立 `yAxisId`**，量纲不同**禁共轴**）；实测轴数 4 条（`indexAxis`/`countAxis`/`turnoverAxis`/`marginAxis` 齐备）。**④ 题材热力日历独立表格** ⇒ 单独一张 `<table>`（实测 25 表头 × 20 数据行，含「合计」列；断言 `heatmapIsOwnTable` PASS）。**⑤ 连板梯队改大表格 + 连板 → 断板自上而下** ⇒ **单张** `<table>`，顶部两条 `colspan` 分组行，顺序**恒为**「连板股 · 当日涨停且 2 板及以上（12 只，板数降序）」→「断板股 · 上一记录交易日 2026-09-17 涨停、当日未再涨停（35 只，其中连板中断 5 只；板数与涨停时间均为上一记录交易日口径）」；实测 `connectionRows = 12` / `brokenRows = 35`、断言 `boardsOrderIsConnectionThenBroken` PASS；行内含 `连板中断`/`首板未续`/`昨日` 三类徽标。**三、🔴 本轮确实动了 `server/**`（与原方案「零 `server/**` 改动」相反，必须记明）**：原方案 E 项把「连板梯队」定为**懒加载区**，正是为回避 `limitUp.getConnectionBoardStats` 的**全表扫描**（`db.ts` 先 `select()` 全表 `limit_up_records` **99,918 行** ⇒ 实测 **68,287ms / 65,557ms**）；但用户第 5 条要求「大表格常显」⇒ 懒加载前提消失、**必须换实现**。**① 新增 `server/boardRoster.ts`**（连板梯队名录**唯一数据源**）：用**有界窗口** `[date − BOARD_ROSTER_LOOKBACK_DAYS(60 自然日 ≈ 45 个记录交易日), date]` 替代全表，实测 **522ms（提速 125.7×）**；导出 `BOARD_ROSTER_LOOKBACK_DAYS` / 类型 `BoardRosterRecord|BoardRosterRow|BoardRosterMetrics|BoardRoster` / 纯函数 `buildBoardRoster(records, date, window)` + `shiftIsoDate` / DB 包装 `getBoardRoster(date, {lookbackDays})`。**板数口径 = 该股在目标交易日前、连续**记录交易日**上均涨停的个数**（与 `db.ts#calculateConsecutiveBoards`、`leaderCandidates.ts#calculateBoards` 同源）；**窗口触顶告警** `boards === window.tradingDateCount ⇒ window.exhausted = true`（**不静默给错数**）；🔴 **边界修正**：目标日**无任何**涨停记录时名录**整体留空** —— 否则会把「上一记录日的全部涨停股」误判成「断板股」。**断板口径** = 上一记录交易日涨停、当日未再涨停；`boards` 取上一记录交易日口径（`boardsAsOfDate === prevDate`）；2 板及以上标 `brokenKind: "connection"`（连板中断）、1 板标 `"first"`（首板未续）。**② 新增 `shared/boardEmotionScore.ts`**（情绪评分公式**单一真源**，无依赖纯函数），由 `server/db.ts` 与 `server/boardRoster.ts` **共同引用** —— 消除两处内联形成的第二套口径；`db.ts` 改后实测 `emotionScore = 28` 不变（**零行为回归**）。**③ `server/db.ts`**：新增 `IndexDailySeriesPoint` + `getIndexDailySeries(indexCode, days = 60)`（`index_daily` 单序列倒序取 N 行后正序返回）。**④ `server/routers.ts`**：`limitUp.getBoardRoster({date, lookbackDays?})` + `market.getIndexDailySeries({indexCode?, days?})` —— **均为只读 query，零迁移 / 零新表 / 零新依赖**。**四、口径零分歧对拍（新旧实现逐股比对）**：78 涨停 / 12 连板 / 最高 4 板 / 情绪评分 28 **全一致**，`boardsMismatchAmongShared: []`，`window.exhausted: false`（45 个记录交易日 ≫ 最高 4 板）。**五、验收（证据落 `docs/evidence/`）**：① `npx tsc --noEmit` = **exit 0**；② 新增单测 `tests/server/boardRoster.test.ts` **14/14 通过**（连续记录日累计 / 空档断连 / 同日重复去重保留早封 / 断板 connection+first 分组 / 当日涨停股不同时进断板名单 / 情绪分与共享公式一致 = 52 / 排序 = 板数降序 + 封板时间升序 / 目标日无记录整体留空 / 窗口触顶告警 / `shiftIsoDate`；共享公式另测：无涨停 = 0、10 板封顶 = 100）—— ⚠️ 过程中**两处断言写错**（`prevTotalLimitUp` 漏算一只、断板排序写反），**实现是对的 ⇒ 已按实现修正测试**；③ 全量 `vitest run` = **8 failed / 17 cases**，失败**文件集合**与基线一致 ⇒ **零新增**；④ 行尾哨兵 `node scripts/checkEolDrift.mjs` **0 漂移**（改前先跑）；⑤ 重跑 `scripts/generateDarkCompatibility.mjs` **零 diff**（无新 Tailwind 颜色类）；⑥ 🔴 **无头 Edge + CDP 按真实导航路径量 DOM**（「接线完成」≠「用户够得到」）：`docs/evidence/_probe_homepage_9be_dom.mjs` → **18/18 ALL PASS**，含 `freshnessTextsAbsent` / `twoChartsRendered` / `heatmapIsOwnTable` / `boardsIsSingleBigTable` / `boardsOrderIsConnectionThenBroken` / `usesRosterEndpoint` / **`avoidsLegacyFullTableEndpoint`（首页实际 trpc 请求清单里确无 `limitUp.getConnectionBoardStats`）** / `usesIndexSeriesEndpoint` / `sidebarExclusiveOnHome`（`/` 恰 1 项 active =「首页」）/ `navClickReachedReview`（点侧栏**真的**到 `/limit-up`，该页恰 1 项 active =「涨停复盘」，且复盘锚点「搜索股票代码」「导出CSV」均在）/ `marketPageStillRenders`（`/market` 回归正常）/ `noPageError` / `noErrorBoundary`；首页实际端点清单实测 = `auth.me` · `limitUp.getBoardRoster` · `limitUp.getDates` · `limitUp.getSectorDistribution` · `market.getIndexDailySeries` · `market.getLimitUpWithMarketData` · `sentiment.getUnreadCount`。**六、遗留（未做）**：① 首页 `boardsTableReadyMs` 实测 **6831ms（热）~ 8845ms（冷启含 trpc 首访）** ⇒ 若仍偏慢，第二阶段把 A~D 收敛为 `dashboard.overview` 聚合端点；② 原 E 项「`limit_up_records.boardCount` 是**死字段**、**禁改读它**代替重算」结论**继续有效**（本轮未触碰该字段，`getBoardRoster` 仍是重算）；③ 原方案「八、第二阶段（本次不做）」仍有效：把 A~D 多数并发查询收敛为 `dashboard.overview`（属 `server/**`，**须排在 `RUNNING` = 0 的时段**）。**七、本轮顺带修正（非产品代码，但会进 diff）**：① **`scripts/generateDarkCompatibility.mjs` 注释失真已修**（本轮改名造成）：「首页包裹层」→「涨停复盘明细页（`LimitUpReview.tsx`，原 `Home.tsx`）包裹层」、`Home.tsx 的 CustomDayButton` → `LimitUpReview.tsx（原 Home.tsx）的 CustomDayButton`；依「**生成物禁手改**」重跑生成器 ⇒ `client/src/theme/darkCompatibility.css` 实测 **规则集零变化**（246 个选择器全等、**0 个选择器声明体改变**、重复选择器仅既有的 2 处 `.dark{}` 且属性不冲突），但**输出顺序变了**（对 HEAD 27 行 diff，**纯排序**）。🔴 **根因**：生成器第 40 行 `const files = walk(SRC)` 按**文件发现顺序**决定「类首见顺序」⇒ 我新增 `Dashboard.tsx` + `git mv Home.tsx → LimitUpReview.tsx` 改变了扫描顺序、进而改了输出顺序；生成器本身是**确定性**的（连跑两次逐字节相同）⇒ 已**保留重跑结果**（不手工回退，否则文件 ≠ 生成器输出）。⚠️ **后续任何 `client/**` 文件增删/改名都会再次触发该排序 churn**（治本 = 让生成器按稳定键排序输出，本轮未做，留作小项）。② 🔴 **`Upload.tsx` 行尾漂移**（哨兵抓到）：该文件 **HEAD blob 纯 LF / 工作区纯 CRLF**，`git` 普通 diff `+701/-701`、**忽略 CR 后才 `+5/-5`** —— 极易被误读成「大改」⇒ 已修回**纯 LF**（现 `+5/-5`），改后哨兵 = **0 漂移**。🔴 **归因修正（本轮不做无证据断言）**：补做对照实验（仓外 `_scratch/_eol_probe.txt` = 纯 LF → `Read` + `Edit` 改 1 行 → 实测 `crlf = 0`、`lf = 3`）⇒ **`Edit` 工具保留 LF、并非元凶**（与 `PROJECT_RULES.md:103` 原判断一致）；真凶仍是**未定的外部同步 / 并发会话**。**教训**：① 漂移态下「改完再看 diff」**一定太晚**（`git status` 因 mtime 命中对未修改文件**全程沉默**）⇒ **改任何文件前先跑哨兵、改完再复跑一次**；② 任何行尾归因**必须先做对照实验**，禁凭直觉推给工具。③ **验收探针两处固定 `sleep` 假失败已修**：复跑时 `marketPageStillRenders` 偶发 FAIL（首跑 PASS）；新增定向探针 `docs/evidence/_probe_market_anchor_dump.mjs`（轮询 + dump `innerText` + 记 HTTP/异常）实测 `/market` 锚点 **5742ms** 才出现、3591ms 时 `bodyLen` 仅 182 ⇒ **固定等 9s 在 Vite 热更新窗口下不够，非回归**（`Market.tsx` 形态与内容零变化、0 错误、0 个 4xx/5xx）。⇒ 已把 `/limit-up` 与 `/market` 两处 `sleep` 改为**轮询到锚点就位**（各记 `readyMs`）；加固后复跑 **18/18 ALL PASS**（`readyMs`：首页 6831ms / 复盘页 547ms / `/market` 4608ms）。**八、边界**：本轮改 `server/**` 前实测 **`RUNNING` Run 计数 = 0** ⇒ **未杀在途 Run**；dev server 在 `:3000`（`tsx watch`，已自动热重启）。

# 45. Entry Criteria / Exit Criteria（实例化）

> 按 §32 为「下一个待执行 STEP」实例化；其余 STEP 在逼近时再实例化。

## 45.1 STEP 12.5 Historical State Reconstruction

- **Entry**：STEP 12 的 A~H 全部 `DATA_READY`（最低数据完整性）
- **Exit**：
  - Historical State Reconstruction 层 `CODE_READY`：对任意 `(security, date)` 可做 `asOf(T)` 查询
  - `VALIDATED`：抽样 PIT 验证通过（无 look-ahead、无 survivorship 泄漏）
- **blocked_by**：STEP 12（A~H 数据域）

## 45.2 STEP 12.6 Research Dataset Certification

- **Entry**：STEP 12.5 完成
- **Exit**：Research Dataset 构建器 `CODE_READY + DATA_READY + VALIDATED`，具备 §12 要求的 `dataset_version / data_snapshot / universe_definition / PIT policy / survivorship policy / corporate action policy / adjustment policy / industry policy / liquidity policy`
- **blocked_by**：STEP 12.5

## 45.3 STEP 13 Research Engine

- **Entry**：`RESEARCH_READY = TRUE`（§13 全部 PASS）+ Research Dataset `VALIDATED`
- **Exit**：Research Engine `CODE_READY + DATA_READY + VALIDATED`，支持 §14 的 `dataset version / strategy version / parameter set / date range / universe / market regime / experiment id`
- **blocked_by**：STEP 12.6（`RESEARCH_READY=FALSE` 期间禁止正式策略结论）

---

# 46. 差异识别（项目现状 vs 本规范）

| # | 差异点 | 现状 | 处置 |
|---|---|---|---|
| 1 | **状态模型升级** | 旧用 `Done/Partial/Pending` | 已切换为 §7 的 7 态模型（见 44.2） |
| 2 | **STEP 12.5 / 12.6 为新增中间层** | 旧路线图无此二层，直接 12→13 | 已纳入 §44.4 依赖链，标记 BLOCKED |
| 3 | **Research Dataset 为核心 Gate** | 旧无独立 Research Dataset，策略可直拼原始表 | 纳入 §45.2，作为 STEP 13 前置硬门槛 |
| 4 | **代码存在 ≠ VALIDATED** | STEP 13~25 引擎/回测/评价代码大部分已实现 | 统一标 `CODE_READY`，禁止因代码存在标 VALIDATED/RESEARCH_READY |
| 5 | **Experiment Registry（§28）** | 待从 STEP 13 建立，当前未落地 | 列为 STEP 13 交付项 |
| 6 | **Provider 架构（§29）** | 已有多 Provider（Tushare/BaoStock/Sina），BaoStock 为主源 | 符合规范，继续记录 `provider/retrieved_at/source_version` |
| 7 | **前端技术栈（Spec V1 §8 建议 Vue）** | 实际 React 19 + Vite 7 + tRPC 11 + Tailwind 4 + recharts + radix + wouter | Spec §8 自定「优先沿用已有技术栈，不得无理由替换」→ **沿用 React 栈**，不迁 Vue/Element Plus/Pinia |
| 8 | **任务状态模型（Spec V1 §12/§32 建议 10 态）** | 项目 §7 已定 7 态（DESIGN/CODE_READY/DATA_READY/VALIDATED/RESEARCH_READY/PRODUCTION_READY/BLOCKED）+ §23 策略 8 态 | Spec §32「不要混用」→ **沿用 7 态**（TASK_TRACKING §0.1 已固化），不引入 BACKLOG/READY/…/CLOSED/DEFERRED 10 态 |
| 9 | **前端任务分解（Spec V1 F1-F7 + FRONTEND-001~024）** | 项目 §48.4 用 FE-0~FE-9（研究链路页面导向） | 两套为同一工作的两种视图，**以 FE-0~FE-9 为权威执行清单**；F1-F7 交叉视图映射见 §48.4 |
| 10 | **Spec V1 §22 假设「Frontend = NOT IMPLEMENTED」** | 实际已有 12 页 5,098 行 legacy（F1 壳/F2 行情部分已存在） | 不重置；在 legacy 壳上新增「研究」导航分组（FE-1 承担），长期收敛 legacy（§48.3 R7） |

---

# 47. 更新记录（append-only）

> 🔴 **正文已于 2026-09-13 迁出**，见 **[`ROADMAP-CHANGELOG.md`](./ROADMAP-CHANGELOG.md)**（718 行 / 约 500 KB）。本标题**只作指针保留 —— 不要在本文件再追加**。
>
> - **写入口**：任务完成后，在 `ROADMAP-CHANGELOG.md` 的**文件末尾追加**一条（append-only，禁止删除 / 覆盖历史记录）。
> - **职责不变**：§47 仍与 §44（覆盖式真实状态）、§44.5（任务队列）并列为 Master Control 三件套 —— 「每任务完成必须更新三者」这条纪律的第三个载体现为 `ROADMAP-CHANGELOG.md`。
> - **零改写**：历史条目逐字节搬运（唯一改动 = 原 `# 47.` 标题行下沉为 `## 更新记录（append-only）`）；本次同时把被 `# 49.` 标题割裂的第二段**并回日志尾部**，`# 49.` 之下不再夹杂日志条目。
> - **体量**：拆分后 `ROADMAP.md` 852 KB → 约 332 KB。

# 48. 后续迭代开发路线（聚焦未完成部分）

> 本章为**尚未完成部分**的权威开发路线，由 §44 真实状态驱动，随任务推进覆盖式更新。
> 已完成项（数据域 A/B/F/G、编码 STEP 12.5~18/21 已达 `CODE_READY`）不在此列，详见 §44。
> **最后更新：2026-09-07 12:59 GMT+8**（gate 实查 PASS 12 / PENDING 5 / FAIL 0，`RESEARCH_READY = FALSE`；§48.4 前端任务补全职责/工作量/Exit/插入节点规格）

## 48.1 阶段总览（优先级 + 依赖）

```text
P0 数据回填收尾
   P0-1 C+E 全量（运行中） ─┐
   P0-2 D 全量（C+E 后串行）─┤─→ P0-3 G 质量修复 ─→ P0-4 H gate 重跑
                             │
                             └─────────────────────────────→（数据域全 PASS）
                                                                    ↓
P1 数据域认证（依赖 P0 全完成）
   P1-1 STEP 12.5 VALIDATED ─→ P1-2 STEP 12.6 DATA_READY+VALIDATED ─→ P1-3 STEP 13 VALIDATED
                                                                    ↓（RESEARCH_READY = TRUE）
P2 研究链编码补齐（编码缺口，可并行；§39 编码先于数据解耦，不依赖 P0/P1）
   P2-1 C-19 WFO ─┬─ P2-2 C-20 Overfitting ─┬─ P2-3 C-18.2 MC/Bootstrap
                  │                         │
   P2-4 C-22 Regime ─ P2-5 C-23 Paper ─ P2-6 C-24 Review ─ P2-7 C-25 闭环
                                                                    ↓
P3 端到端验证（依赖 P1 + P2 完成）
   真实数据跑通「主观规则 → 回测 → 评价 → 优化 → 稳健性 → OOS → 过拟合 → 模拟 → 复盘」全闭环
                                                                    ↓
P4 前端研究链路 UI（§48.4，研究能力消费层）
   UI 骨架线（FE-1~FE-6 组件/页面）可与 P0/P1/P2 并行（UI 不依赖真实数据，仅依赖 FE-0 tRPC 契约）
   真实数据联调线依赖 FE-0 tRPC 暴露 + P1 数据认证 + P2 编码补齐
```

| 阶段 | 优先级 | 前置依赖 | 当前状态 |
|---|---|---|---|
| P0 数据回填收尾 | **P0** | — | C+E 运行中（12:37 实查） |
| P1 数据域认证 | **P1** | P0 全完成 | BLOCKED（等数据域全 DATA_READY） |
| P2 研究链编码补齐 | **P2** | 编码缺口，可并行 | 部分缺口（7 个编码任务未做） |
| P3 端到端验证 | **P3** | P1 + P2 | 未开始 |
| P4 前端研究链路 UI | **P4** | FE-0 tRPC 暴露（server 侧）+ P1 数据认证（真实数据联调）；骨架线自 FE-0 后即并行 | 未开始（现有 12 页全 legacy，研究链路 UI 缺失）；规格已定（§48.4 12:59 补全：职责/工作量/Exit/插入节点） |

---

## 48.2 各阶段详情

### P0-1 ｜ C+E 全量回填（Status + Liquidity）— ✅ 完成（2026-09-09）

- **范围**：`research_security_status_history`（SUSPENSION 停牌 + ST 事件态，来自 BaoStock tradestatus/isST）+ `liquidity_daily`（turn/amount/volume，单位归一）。复用提速改造版 `scripts/backfillStatusLiquidity.ts`（单 Python 驻留会话 + 2019+ 范围收敛）。
- **依赖**：无（BaoStock 单 Session 独占中，§30 禁止并发 D）。
- **验收标准（完成标志）**：
  - `liquidity_daily` 覆盖 **≥ 5000 只** distinct securityCode（gate #9 阈值）：✅ **5,131 只**（9/9 补跑达标）。
  - `research_security_status_history` 覆盖全市场**有停牌/ST 事件的股票**（事件态，非全市场 LISTING——见 §48.3 风险 R1）：✅ 事件态覆盖 **1,830 只**（SUSPENDED 1,830 + ST 734），gate #6/#12 PASS。
  - `tsc --noEmit` 干净；回填日志 `Persisted status_intervals / liquidity_rows` 与 DB 实查一致。

### P0-2 ｜ D 全量回填（Corporate Actions + Adjustment）— ✅ 完成（2026-09-09）

- **范围**：`corporate_actions`（分红/送转/配股/拆合股）+ `adjustment_factors`（复权因子）。复用 `scripts/backfillCorporateActionsBaostock.ts`（factors 按交易日批量 + dividend 分批 checkpoint resume，CHUNK=100 防会话超时）。
- **依赖**：P0-1（C+E）完成后串行启动（BaoStock 单 Session）。主板 9/8 完成 → 创业板/科创板 9/9 03:01 完成。
- **验收标准**：
  - `corporate_actions` 覆盖 **≥ 5000 只**（gate #10）：**口径修正为「CA ≥ AF − 容差 250」**（事件态表，见 P0-4 落地与 certify 注释）✅ CA 4,824 / AF 5,025，缺口 201 ≤ 250（缺口股票实查无分红送转事件）。
  - `adjustment_factors` 覆盖 **≥ 5000 只** distinct securityCode（gate #11 阈值）✅ 5,025 只。
  - 复权因子区间无重叠（PIT）、单位归一正确（gate #15 质量校验 PASS）。

### P0-3 ｜ G 行业数据质量修复

- **范围**：`industry_assignments` 两处数据质量待办（§44.1 备注）：① `securityId` 全 5212 行 NULL → 用 `code→research_securities` 桥接一次性回填 canonical identity（§6 身份铁律）；② `effectiveFrom` 单点 `2026-08-31` → 声明「当前快照口径」（BaoStock 无历史行业轨迹），历史 asOf(T) 行业查询用 retrievedAt 近似，严格 PIT 需另寻历史源（申万历史成分/聚宽）或显式声明 CONDITIONAL GAP。
- **依赖**：P0-1 完成后可与 P0-4 并行（写 DB 但不同表，无 BaoStock 竞争）。
- **验收标准**：`industry_assignments.securityId` 非 NULL 覆盖 100%；gate #7 Industry 保持 PASS 且 identity 校验通过。

### P0-4 ｜ H gate 重跑 + 阈值修正 — ✅ 完成（2026-09-09 03:33）

- **范围**：重跑 `scripts/step12_certify_gate.mjs`；修正 gate #6 Historical Status 阈值（见 §48.3 R1）；确认 gate #12 Historical Universe 可重建语义。
- **依赖**：P0-1/P0-2/P0-3 完成。
- **落地（2026-09-09）**：
  - **#6/#12 Historical Status 口径修正（R1）**：status history 为事件态表，判定改为「SUSPENDED 与 ST 类型齐备 && 覆盖证券数 ≥ 1,500」；LISTING/DELISTING 全量边界由 #4 securities（5,552 只）承载。新阈值常量 `statusEventCoverMin=1500`。
  - **#10 Corporate Actions 口径修正**：事件态表，判定改为「CA 覆盖 ≥ AF 覆盖 − 容差 250」；容差覆盖「有复权因子但 BaoStock 无分红送转事件」的证券（9/9 实查 9 只样本 query_dividend_data 均 0 行证实）。新阈值常量 `caGapTolerance=250`。
- **验收标准（完成标志）**：
  - gate 17 项中**数据域项（dataScope）全部 PASS**：✅ **17/17 全 PASS（0 PENDING 0 FAIL）**。
  - `RESEARCH_READY = TRUE`（这是进入 STEP 13 正式研究的硬门槛，§13）：✅ **2026-09-09 03:33 判定 `RESEARCH_READY = TRUE`**（快照 `docs/researchReadyGate/research_ready_gate.json` capturedAt 2026-09-08T19:33:43Z）。

---

### P1-1 ｜ STEP 12.5 Historical State Reconstruction 认证（VALIDATED）

- **范围**：`server/historicalState/`（reconstruct asOf(T) 查询层 + audit/ PIT 反泄漏抽样验证）已 `CODE_READY`（单测 28+29 例全过）。本阶段 = 用**真实数据**跑 `scripts/runStep125PitAudit.mts` 全量抽样。
- **依赖**：P0 全完成（A~H 全 DATA_READY）。
- **验收标准**：
  - 真实 DB 抽样 PIT 审计 gate = **PASS**（无 look-ahead、无 survivorship 泄漏）。
  - 任意 `(security, date)` 可回答 §11 十问（身份/上市/退市/行业/可交易/流动性/价格/公司行为/市场状态/可知性）。
  - 状态 `VALIDATED`（§0.2 禁止越级，数据就绪后认证）。

### P1-2 ｜ STEP 12.6 Research Dataset Certification（DATA_READY + VALIDATED）

- **范围**：`server/researchDataset/`（builder/validate/version/universe/assemble/policy/versionSnapshot）已 `CODE_READY`（单测 37 例全过）。本阶段 = 用真实数据跑 `scripts/runStep126BuildDataset.mts` 产出正式 `datasetVersion`。
- **依赖**：P1-1 完成。
- **验收标准**：
  - 产出正式 `dataset_version`（确定性 `rd-<builder>-<rowSchema>-<sha256>`）+ `data_snapshot`（A~G 域统计）+ `coverageGaps` 空（或如实声明 CONDITIONAL GAP）。
  - 具备 §12 要求的 9 类 policy（PIT/survivorship/corporate-action/adjustment/industry/liquidity/universe/calendar/knowledge）。
  - Research Dataset 构建 gate = **PASS**；状态 `DATA_READY + VALIDATED`。

### P1-3 ｜ STEP 13 Research Engine 认证（VALIDATED）

- **范围**：`server/research/`（framework + datasetAccess + signal13 + experimentLineage）已 `CODE_READY`（research 365→415 例全过）。本阶段 = 用 Research Dataset 跑通 Feature→Signal→Candidate→Evaluation 并验证 §14 契约（dataset/strategy/param/date-range/universe/regime/experiment-id）。
- **依赖**：P1-2 完成（RESEARCH_READY=TRUE + Research Dataset VALIDATED）。
- **验收标准**：
  - 一次真实数据 Candidate Run 端到端确定性可复现（同 datasetVersion 两次运行结果一致）。
  - Experiment Registry（§28）记录完整（15 字段谱系齐备）。
  - 状态 `VALIDATED`；**此后才允许正式策略结论**（§39）。

---

### P2 ｜ 研究链编码补齐（7 个编码缺口，可并行）

> 以下编码任务在 §39 下「编码先于数据」解耦，可与 P0/P1 并行推进，但**正式策略结论**仍须等 P1 完成后（§39）。

| 编码任务 | STEP | 范围（模块） | 依赖 | 验收标准（CODE_READY 完成标志） |
|---|---|---|---|---|
| **C-19.1/19.2** | §21 WFO/OOS | `server/research/` Walk-Forward 三段编排（Train→Optimize→Freeze→Test→Move Window），严格 IS/OOS 隔离，保存 window/train/test/params/result | C-17.2 | OOS 数据不参与参数优化（铁律）；单测覆盖三段编排 + 窗口移动；tsc 干净 |
| **C-20.1** | §22 Overfitting | `server/research/` Overfitting 正式判定（PBO/参数敏感性/因子消融/OOS 退化） | C-18.1 | 识别「回测好但泛化差」；PBO 计算确定性；单测 + tsc 干净 |
| **C-18.2** | §20 Robustness 剩余 | `server/research/robustness18/` MC/Bootstrap/Trade Order Randomization/Execution Perturbation | C-18.1 | 四轴扰动补全；每轴确定性可复现；单测 + tsc 干净 |
| **C-22.1** | §24 Market Regime | `server/research/` 独立 Regime 模块（Trend/Volatility/Liquidity/Breadth/Sentiment/Index/Limit-up 环境） | C-15.1 | regime 标签确定性；接入 C-16.3 assessed 扩展槽；单测 + tsc 干净 |
| **C-23.1** | §25 Paper Trading | `server/` Paper Trading（复用 signal/position/execution/risk/capital/cost，记录 paper run 全链路） | C-14.3 | 与真实交易成本/执行一致；记录 paper run + PnL；单测 + tsc 干净 |
| **C-24.1/24.2** | §26 Review/Discipline | `server/` Trade Journal + 纪律反馈（Signal/Planned/Actual/Deviation/Emotion/Rule Violation/Post-trade） | — | 识别「为何违反规则/重复错误/最差执行/易错环境」；单测 + tsc 干净 |
| **C-25.1** | §27 闭环 | `server/` Production Quant Platform 集成（Data→Research→…→Discipline 全链路编排） | C-21.1 + C-22.1 + C-24.2 | 端到端可走通「主观规则→可执行规则」；单测 + tsc 干净 |

> **已完成编码（无需再编码，仅等数据认证）**：STEP 12.5（C-12.5.1/2）、12.6（C-12.6.1/2）、13（C-13.1/2/3）、14（C-14.1/2/3）、15（C-15.1）、16（C-16.1/2/3）、17（C-17.1/2）、18（C-18.1）、21（C-21.1）——均已 `CODE_READY`，见 §44.4。

---

### P3 ｜ 端到端验证（真实数据跑通完整闭环）

- **范围**：用一个真实的主观交易模式（用户规则）走通 §1 全闭环：数据 → 标准化 → 身份 → 历史状态重建 → Research Dataset → 策略定义 → 信号 → 回测 → 评价 → 优化 → 稳健性 → WFO/OOS → 过拟合 → 模拟交易 → 复盘 → 纪律反馈。
- **依赖**：P1（RESEARCH_READY=TRUE）+ P2（编码补齐）。
- **验收标准（完成标志）**：
  - 一条策略从定义到复盘的全链路结果**可复现**（固定 datasetVersion + strategyVersion + codeVersion）。
  - 每个环节产出可审计记录（Experiment Registry / TradeSimulationRun / EvaluationRun / RobustnessRun / RollingOptimizationRun / PaperRun）。
  - `RESEARCH_READY → … → PRODUCTION_READY` 状态链逐级达成（§37，禁止跳跃）。

---

## 48.3 关键风险与待决策

| # | 风险/待决策 | 影响 | 建议处置 |
|---|---|---|---|
| R1 | **gate #6 阈值 5500 不合理**（原）：`research_security_status_history` 只回填事件态（SUSPENSION+ST），非全市场 LISTING 快照；LISTING/DELISTING 由 `research_securities.listedDate/delistedDate` 提供（STEP 12.5 reconstruct 已按此设计）。 | gate #6 永远 PENDING，阻塞 `RESEARCH_READY=TRUE` | ✅ **已修正（2026-09-09 P0-4 落地）**：#6/#12 改「事件类型齐备 + 覆盖 ≥ 1,500」事件态口径；#10 CA 同批修正为「≥ AF − 容差 250」。certify 17/17 全 PASS，`RESEARCH_READY = TRUE` |
| R2 | **G 行业历史轨迹缺失**：BaoStock 只给「当前」行业，`effectiveFrom` 单点 | 历史 asOf(T) 行业查询只能近似 | 声明「当前快照口径」为 CONDITIONAL GAP；严格 PIT 需另寻历史源（申万历史成分/聚宽） |
| R3 | **OHLCV 5796 股 > securities 5552**（约 235 只差异，含 BJ/退市） | 数据对账待澄清 | P0-4 gate 验证时做 cross-domain 对账，明确差异来源 |
| R4 | **BaoStock 单 Session 串行约束**（§30） | C+E→D 必须串行，总耗时 ~10h+ | 维持串行；D 完成后立即启动；编码任务（P2）不受此约束可并行 |
| R5 | **C+E 回填进程跨会话不可控**（本机进程视图枚举不到） | 无法精确 kill/重启 | 以 DB 写入为准判断存活；resume 幂等断点无损（§47 已多次验证） |
| R6 | **研究链路 tRPC 未暴露**（`server/routers.ts` appRouter 无 research/historicalState/researchDataset 路由） | 前端无法消费任何研究能力（12 页全 legacy） | FE-0 作为前端 P0 前置优先落地（§48.4） |
| R7 | **前端 legacy 页面与研究链路两套口径并存** | 用户可能在「非研究可信度口径」的 legacy 页面下结论，违反 §0.2 | 新页面明确标注口径；长期收敛 legacy 页面（§48.4） |

---

## 48.4 前端开发路线（研究链路 UI）

> **定位**：前端是研究链路的**消费层**，目标是让用户（主观交易者）通过 UI 走通「主观规则 → 研究 → 结论 → 复盘」闭环，把研究结果**落地为可执行规则**，而非堆页面。
> **铁律对齐**：§2「不得为 UI 展示牺牲研究可信度」、§41「不以 UI 页面数量衡量成功」——每个页面必须服务于一个可审计的研究环节，禁止 mock 冒充真实数据（§0.2）。
> **现状（12:40 实查）**：现有前端 `client/src/pages/` 共 **12 页 5,098 行**，全部为 legacy 功能（涨停复盘/大盘分析/情绪分析/龙头候选/组合回测/前向纸面交易/上传/录入/行情同步/情绪预警/操作日志），**无任何研究链路 UI**。而后端研究链路 `server/research/` 26,938 行 + `researchDataset/` + `historicalState/` 已 `CODE_READY`（STEP 12.5~21），**但均未通过 tRPC 暴露**（`server/routers.ts` appRouter 仅 system/auth/limitUp/image/operationLog/watchlist/market/sector/sentiment），前端无法消费。**故前端开发任务整体缺失，本章补齐。**
> **12:59 补充**：本章按用户要求补全逐 FE 任务的「具体职责 / 预估工作量 / 完成标准（Exit）/ 插入节点」规格（见下方规格表），工作量口径沿用 DEVELOPMENT_PLAN §2（S/M/L + agent-日，计划级估算，认领后校准）。

### F1-F7 交叉视图映射（Spec V1 §7 前端路线 vs 本 §48.4）

> Spec V1 将前端表述为 F1~F7 横向工作流（贯穿 STEP 12~25），本 §48.4 用 FE-0~FE-9 页面导向分解。二者为同一工作的两种视图，**执行以 FE-0~FE-9 为权威**（避免第二套并行路线），映射如下：

| Spec F | 本 §48.4 对应 | 现状 |
|---|---|---|
| F1 Application Shell | 既有 legacy 壳（client/_core + components/ui + wouter）+ FE-1「研究」导航分组 | 壳已存在；研究导航待 FE-1 |
| F2 Market Terminal | 既有 legacy 页（Market/Home/LeaderCandidates/SentimentAnalysis） | 已存在（legacy 口径，R7） |
| F3 Research Workbench | FE-2 asOf 查询 + FE-3 数据集构建 + FE-4 策略编辑器 | 未实现 |
| F4 Backtest + Evaluation | FE-5 绩效仪表盘（legacy Backtest.tsx 为组合回测，非研究链路） | 未实现 |
| F5 Optimization + Validation | FE-6 参数搜索/鲁棒性 + FE-7 WFO/过拟合 | 未实现 |
| F6 Paper + Review | FE-8 Regime + FE-9 复盘 | 未实现 |
| F7 Audit + Production | FE-1 数据域健康/gate + FE-9 生产闭环 + Audit Center | 未实现 |

> 前置：**FE-0 tRPC 暴露**是 F1-F7 与 FE-1~FE-9 共同的 P0 硬前置（appRouter 无 research/historicalState/researchDataset 路由，见 R6）。

### FE-0 ｜ 前置：研究链路 tRPC 暴露（server 侧，非前端代码）

- **范围**：新增 `research` / `historicalState` / `researchDataset` 三个 tRPC router，把已 `CODE_READY` 的后端模块查询/命令暴露给前端；契约类型下沉 `shared/`。
- **优先级**：**P0**（所有前端页面的硬前置）。
- **交付成果**：tRPC router + `shared/` 契约类型 + 契约单测；`client/src/lib/trpc.ts` 可类型安全调用。
- **状态（2026-09-07 13:32）：`CODE_READY` ✅ R6 已解除**。落地：`shared/researchContracts.ts`（唯一契约来源，领域对象 `z.custom` 类型透交由后端权威校验，枚举一致性由契约单测断言守护）+ `server/historicalStateRouter.ts`（asOf，复用 STEP 12.5 只读）+ `server/researchDatasetRouter.ts`（build，**只回传摘要剔除 rows**，gate 原样透传，RPC 限流默认 5 日/50 股）+ `server/researchRouter.ts`（strategy.validate/bump/compare + lifecycle.describe/transition，状态与迁移表取自后端常量）+ 三 router 注册 appRouter。契约单测 12 例全过、`tsc --noEmit` exit 0。依赖真实 DB 的 asOf/build 不在单测覆盖（§0.2 禁 mock），由既有 CLI smoke + P1 认证承担。

### 前端页面任务（FE-1 ~ FE-9）

| 任务 | 对应 STEP | 范围（页面/组件） | 依赖 | 优先级 | 交付成果 |
|---|---|---|---|---|---|
| **FE-1 数据域健康看板** | §44 gate | 新增「研究数据」导航分组 + 页面：A~G 数据域行数/覆盖/状态（FULL/PENDING）、gate 17 项 FAIL/PASS/INCONCLUSIVE、`RESEARCH_READY` 状态灯、后台回填进度 | FE-0 | **P0** | 数据域健康看板页（替代 agent 手工实查 DB） |
| **FE-2 历史状态查询器** | §12.5 | 输入 (security, date) → asOf(T) 可知状态十问（身份/上市/退市/可交易/行业/流动性/价格/公司行为/市场状态/可知性） | FE-0 + 数据域 DATA_READY | P0 | asOf 查询页 |
| **FE-3 数据集构建器** | §12.6 | 配置 from/to/asOf/maxDays → 触发 build → 展示 datasetVersion（确定性哈希）/data_snapshot/coverageGaps/9 类 policy | FE-0 + STEP 12.6 DATA_READY | P1 | 数据集构建页 + 版本快照浏览 |
| **FE-4 策略编辑器 + 运行工作台** | §13/§15/§16 | 主观规则 → StrategyDocument 编辑表单（entry/exit/positionSizing/riskRules/executionAssumptions）、策略 semver 版本化、触发单次研究运行 | FE-0 + STEP 13 | P1 | 策略编辑页 + 运行结果页 |
| **FE-5 绩效仪表盘** | §14/§16 | Equity 曲线、Drawdown 图、Trade 明细、指标卡（CAGR/MaxDD/Sharpe/Sortino/Calmar/WinRate/PF/Expectancy/Turnover/月年度一致性）、Regime 表现 | FE-0 + C-14/16 认证 | P2 | 绩效仪表盘（图表 + 指标 + 交易明细表） |
| **FE-6 参数搜索 + 鲁棒性 UI** | §17/§18 | Grid/Random/Rolling 搜索配置 + 稳定区可视化 + 鲁棒性四轴扰动报告（成本/滑点/参数/执行） | FE-0 + C-17/18 | P2 | 参数搜索页 + 鲁棒性报告页 |
| **FE-7 WFO/OOS + 过拟合判定 UI** | §21/§22 | Walk-Forward 三段编排 + OOS 结果 + PBO/过拟合判定可视化 | FE-0 + C-19/20 编码 | P2 | WFO 页 + 过拟合判定页 |
| **FE-8 Regime + 报告生成 UI** | §24/§25 | Regime 标签可视化 + 研究结论报告导出 | FE-0 + C-22/23 编码 | P3 | Regime 面板 + 报告导出页 |
| **FE-9 复盘纪律 + 生产闭环 UI** | §26/§27 | 纸面交易生命周期 + 复盘纪律（单笔全生命周期：建仓→加仓→做T→清仓）+ 生产闭环看板 | FE-0 + C-24/25 编码 | P3 | 复盘工作台 + 生产闭环看板 |

- **状态（2026-09-07 13:55）：FE-1 `CODE_READY` ✅**。落地：`shared/dataHealthContracts.ts`（唯一契约来源：gate 状态/域/覆盖率/证据/实况的 zod 契约）、`server/dataHealth.ts`（**只读真实证据**——判定源自 `docs/step12-evidence/research_ready_gate.json`（certify 脚本只读 TiDB 生成），本模块只做读取→schema 校验→派生展示字段，**不重算 gate**；域→gate 项映射 DOMAIN_SPEC 单一来源；覆盖率取**最差来源**保守口径；文件缺失/schema 不匹配 → parseError 不伪造）、`server/dataHealthRouter.ts`（overview/evidence/liveCounts 三端点；`liveCounts` 带 `certified:false` 字面量类型，认证态与实况态**类型级分离**）、`client/src/pages/DataHealth.tsx`（RESEARCH_READY 状态灯 + A~G 七域卡 + gate 17 项明细表 + 数据快照 + 证据产物 + 未认证实况 Tab）。**性能发现**：实况查库首版用 UNION ALL 全表 COUNT(DISTINCT)（含 8.9M 行 stock_daily_prices）在回填并发写下 >5min 挂起 → 重构为「information_schema 估算行数（O(1)，标注≈）+ 逐表精确 COUNT(DISTINCT) + 单表 25s 超时保护 + 超大表不查覆盖（其覆盖已由 gate#3 PASS 给出）」。**验证**：13 例单测全过（读真实证据文件断言规则一致性，非硬编码漂移值；缺失/口径漂移保守 PENDING）、`tsc --noEmit` exit 0、`vite build` 通过。实况端点依赖真实 DB，默认不自动触发（手动按钮），与回填并发存在争用为已知限制。
- **状态（2026-09-07 14:15）：FE-2 `CODE_READY` ✅（骨架 + 真实联调就绪，数据待 M0）**。落地：shared 契约补 `historicalStateResolveInputSchema`/`codeCandidateSchema`/`historicalStateResolveResultSchema`（FE-0 只有 asOf 入参，FE-2 增补**代码解析**入/出契约，契约先行）；新增 `server/historicalState/codeLookup.ts`（`parseCodeQuery` 纯函数：6 位数字 ±.SH/.SZ/.BJ 后缀；`lookupSecuritiesByCode` DB 检索 identifier history × securities master，**代码可复用故返回候选集**，primary 优先归并；DB 不可用/15s 超时 → error 明示，不返回空数组冒充「查无此代码」）；`server/historicalStateRouter.ts` 增 `resolveCode` 端点（output schema 强约束）；新增 `client/src/pages/HistoricalState.tsx` + App.tsx 路由 `/historical-state` + AppShell「研究数据」分组加「历史状态查询」。页面十问渲染：Q10 可知性审计维度 chips 先行（KNOWN/UNKNOWN 不粉饰）+ Q1 身份 / Q2·Q3 生命周期（verdict 徽标）/ Q5 可交易（**剔除原因原样展示**，UNKNOWN 不默认放行）/ Q4 行业 / Q6 流动性 / Q7 价格（**A 股红涨绿跌着色**）/ Q8 公司行为（Q8a 已生效 vs Q8b·Q10 asOf 已知双层口径分列）/ Q9 市场状态表；**asOf 留空 = FULL_KNOWLEDGE 全知视角明示警告**（§4 PIT，研究必须显式传 asOf）；查询返回 null（DB 不可用/标的不存在）→ 黄条明示不伪造「全 UNKNOWN」假状态。类型经 `inferRouterOutputs<AppRouter>` 从后端推断，**不复制领域 schema**。**验证**：7 例单测全过（parseCodeQuery 边界：空/大小写/后缀/非法输入可读错误；无 DB 环境 lookup 诚实失败；接线守卫）、`tsc --noEmit` exit 0、`vite build` 通过（+FE-1/FE-0 回归 32/32）。真实 asOf 联调依赖 M0 数据就绪（DB 回填期间 TiDB 饱和，resolve/asOf 均带超时兜底）。
- **状态（2026-09-07 14:22）：FE-3 `CODE_READY` ✅（纯前端骨架，真实构建联调待 M0）**。落地：`client/src/pages/DatasetBuilder.tsx` + App.tsx 路由 `/dataset-builder` + AppShell「研究数据」分组加「数据集构建」（legacy 壳增量，不重置）。**契约零改动**：`researchDataset.build` 已在 FE-0 暴露（shared 入参契约完整），FE-3 只做消费方页面。页面设计：左侧构建配置表单（名称/from/to/**逐日 PIT vs 固定 asOf 联动**/maxTradingDays≤40/maxSecuritiesPerDay≤1000/dataReady 勾选；默认值对齐 RPC 护栏 5 日/50 股/false，表单内明示「未勾选 dataReady → gate 至多 INCONCLUSIVE」）；右侧结果区（mutation 驱动，isPending/error/空态齐备）。**三块只读渲染**：① 总览卡 datasetVersion（确定性指纹 mono）+ gate 徽标（PASS/FAIL/INCONCLUSIVE **原样着色不粉饰**）+ rowCount + gateNotes；② Tabs 三页——数据快照（请求规范化回显/日历/交易日/域快照表/coverageGaps 红条 or 无缺口绿条）、9 类口径 policySet 表（policyId/name/机器可读 value **逐键渲染不依赖具体 schema**/evidence chips）、成员决议 universe（rule/asOfDescription/每日成员数+排除统计；members id 列表只汇总不逐条回展）。**关键取舍**：summary 中 universeDefinition/policySet/dataSnapshot 在 shared 契约为 `unknown`（RPC 透传无第二份口径），页面用「防御性取值」helpers（isRecord/pickStr/pickNum）渲染，字段缺失即显「—」，不猜结构、不复制领域 schema；rows 永不回传只显 rowCount。**验证**：`tsc --noEmit` exit 0、`vite build` 通过（12.7s）、FE-0/FE-1/FE-2 回归 **32/32**。真实构建联调依赖 M0 数据就绪（build 为同步长任务，DB 回填期间可能等待较久——页面已明示）。
- **状态（2026-09-07 14:35）：FE-4 `CODE_READY` ✅（首个端到端真测 FE，纯函数端点全链路走通）**。落地：`client/src/pages/StrategyEditor.tsx` + App.tsx 路由 `/strategy-editor` + AppShell「研究数据」分组加「策略工作台」。**契约零改动**：`strategy.validate/bump/compare` + `lifecycle.describe/transition` 已在 FE-0 暴露（shared 契约完整），本次纯消费方页面。三 Tab：① 策略编辑器——JSON 编辑器透传完整 StrategyDocument（§16），validate → 结构化 issue 表（code/path/message），fingerprint 占位明示（validate 只查非空，真实指纹后端序列化重算）；② 版本化——bump 工具（major/minor/patch）+ compare 字段级 diff（path/kind/left→right，忽略 version/fingerprint）；③ 生命周期——describe 状态机（8 态 chips + 迁移表，后端常量唯一事实来源）+ transition 表单（to 下拉按 describe.transitions[currentStatus] 动态过滤/reason/timestamp/experimentId/actor/evidence JSON），返回新 record（status 徽标 + transitions 历史链表 + fingerprint）。**关键取舍**：① 模板（合法 StrategyDocument + 合法 genesis 生命周期壳）由**后端纯函数生成一次**后内嵌为前端常量，前端只透传、不重算 fingerprint/chain hash（§31）；② StrategyDocument/StrategyLifecycleRecord 以 `z.custom` 透传，语义与 hash 链由后端 `validateStrategyDocument`/`applyLifecycleTransition` 权威校验，页面不复制 schema；③ 迁移不满足 §23 四要素/迁移表时后端抛错，页面原样展示 tRPC error 不吞异常；④ `to` 类型断言复用 shared `StrategyLifecycleStatusValue`（不另造字面量）。**验证**：`tsc --noEmit` exit 0、`vite build` 通过（14.6s）、回归 70/70（strategySchema 28 + lifecycle21 30 + 契约 12）+ **端到端 smoke 6 项全过**（createCaller 实走：validate.valid=true / bump 1.0.0→1.1.0 / compare 定位 name 差异 / describe 8 态 Draft→[Research,Retired] / transition Draft→Research 成功 status=Research / 跳级 Draft→Candidate 被拒）。

- **状态（2026-09-08 22:55）：FE-5 绩效仪表盘 `CODE_READY` ✅（骨架线；真实曲线联调待 C-14/16 VALIDATED）**。新增 `client/src/pages/PerformanceDashboard.tsx` + App.tsx 路由 `/performance` + AppShell「研究数据」分组加「绩效仪表盘」。**契约零改动 / 零数据伪造**：研究 run/metrics 端点（FE-0 扩展）未暴露、C-14/15/16 未 VALIDATED → 页面呈现完整结构 + 全空态。结构：数据就绪门（三前置清单：run/metrics 端点暴露 / C-14·16 VALIDATED / 结果数据可到手）+ 绩效指标卡 11 项（总收益率/CAGR/MaxDD/Sharpe/Sortino/Calmar/胜率/PF/Expectancy/Turnover/交易次数，数值全「—」，hint 为口径）+ Equity/Drawdown 双曲线占位 + 交易明细表（列头按 engine/domain Trade 真实契约）+ 月/年一致性（C-16.3）+ Regime 表现（marketRegime attribution）空态 + TechnicalDetails 联调清单（PerformanceMetrics 字段字典）。**纪律**：指标卡不显数值、曲线不引入图表库、空态不缓存假样例；字段字典取真实引擎契约，联调时同源直填、不做第二份口径。**验证**：`tsc --noEmit` exit 0、`vite build` 通过、client 17 测试全过。

- **状态（2026-09-08 23:20）：FE-6/7/8/9 `CODE_READY` ✅（并行骨架线；真实联调分别待 C-17/18、C-19/20、C-22/23、C-24/25 认证 + 对应 run/search/regime/review 端点暴露）**。四页**并行开发**交付（独立 agent 各写一页，路由/导航主 agent 统一注册）：`client/src/pages/ParameterSearch.tsx`（`/parameter-search`）+ `WalkForwardAnalysis.tsx`（`/walk-forward`）+ `RegimeReport.tsx`（`/regime-report`）+ `ReviewWorkbench.tsx`（`/review-workbench`），AppShell「研究数据」分组增至 9 项。**契约零改动 / 零数据伪造**：字段字典 1:1 取自真实引擎契约（parameterSearch/rollingOptimization/robustness/stochasticRobustness · walkForwardRun/oosIsolation/overfittingDetection · marketRegime · tradeJournal/disciplineFeedback/paperAccount），子 agent 精读代码后提取、非臆造。**§48.4 关键验收点落实**：FE-7 每个 fold 条内 IS（训练·样本内 slate 底）与 OOS（样本外 indigo 底 + 警示）**视觉隔离固化**（图例 + 明确标签，防误用）；FE-9 顶部琥珀色 **R7「非研究可信度口径」隔离条**（legacy 数据流 ≠ RESEARCH_READY 研究链路）。共享骨架纪律：就绪门卡（前置清单，全「未就绪」）+ 空态/占位 + TechnicalDetails 字段字典与联调清单；配置/运行按钮 disabled+tooltip（后端无端点）；不引图表库、零 trpc 调用、零假样例。FE-8 如实注明「报告导出模块尚未存在」（检索 server/research 与 server/ 无 renderReport 类导出服务）。**修复**：ParameterSearch 字段字典把类型字面量 `{…}` 直接写进 JSX 文本被解析为逗号表达式 → 三处改字符串表达式。**验证**：前端 tsc 零错误（全量残留报错仅在 `server/research/closedLoop/*`——并行协调者在途 C-25.1 编码噪音，非本任务范围）、`vite build` 通过、client 17 测试全过。

### 前端任务职责、工作量与插入节点（12:59 补全规格）

> 角色约定：**frontend-dev** = 页面/组件/图表实现；**research-dev** = 后端 tRPC 暴露与语义复核；**协调者** = 验收、口径裁定、合入统一出口。工作量按 §2 分级（S/M/L），含组件单测与 tsc 复核，**不含**后端对应 STEP 编码（另计）。

| 任务 | 职责（谁执行 / 谁复核） | 预估工作量 | 完成标准（逐任务 Exit） | 插入节点（阶段/里程碑） |
|---|---|---|---|---|
| **FE-0** | research-dev（server 侧契约暴露）+ frontend-dev（`trpc.ts` 接线） | M（约 1 agent-日） | tRPC 契约编译通过 + 契约单测通过 + 前端类型安全调用；R6 解除 | **P0 前置**：独立于数据链，批次 0/1 即可开工；完成后解锁全部 FE |
| **FE-1** | frontend-dev 实现 / 协调者复核数据语义 | M（约 1 agent-日） | 页面上显示 gate 17 项真实状态（FAIL/PASS/INCONCLUSIVE）+ `RESEARCH_READY` 灯 + 数据域行数/覆盖（读真实 gate JSON/DB，非 mock） | P0 后段（gate 数据源可用即可联调）；完整数据待 M0 |
| **FE-2** | frontend-dev 实现 / research-dev 复核 asOf 语义 | M（约 1 agent-日） | (security,date) → 十问真实渲染；与 `server/historicalState` 输出一致；空态/加载态/错误态齐备 | 骨架可先做（FE-0 后）；真实数据联调 **M0+P1-1** |
| **FE-3** | frontend-dev 实现 / research-dev 复核 datasetVersion 确定性 | M（约 1 agent-日） | 触发真实 build → 展示 datasetVersion/data_snapshot/coverageGaps/9 类 policy；两次构建哈希一致 | 骨架可先做（FE-0 后）；真实构建联调 **M0+P1-2** |
| **FE-4** | frontend-dev 实现 / research-dev 复核 schema 版本化 | L（约 2 agent-日） | StrategyDocument 全字段表单 + semver bump + 版本比较 + 保存/加载 round-trip 指纹 | 骨架可先做（FE-0 后）；真实运行联调 **P1-3（RESEARCH_READY 后）** |
| **FE-5** | frontend-dev 实现 / research-dev 复核指标口径 | L（约 2 agent-日） | Equity 曲线/MaxDD 图/Trade 表/指标卡与 C-16 输出一致（同源数据渲染）；图表组件与后端口径逐字段核对 | 骨架可先做（FE-0 后）；真实曲线联调 **C-14/16 VALIDATED（P2 后）** |
| **FE-6** | frontend-dev 实现 / research-dev 复核搜索语义 | L（约 2 agent-日） | Grid/Random/Rolling 配置页 + 稳定区可视化 + 鲁棒性四轴报告，渲染 C-17/18 真实产物 | 骨架可先做（FE-0 后）；真实搜索联调 **C-17/18 VALIDATED（P2 后）** |
| **FE-7** | frontend-dev 实现 / research-dev 复核 OOS 语义 | M/L（约 1.5 agent-日） | WFO 三段编排展示 + OOS 结果 + PBO/过拟合判定可视化；**OOS 区与训练区视觉隔离**（防误用） | 骨架可先做（FE-0 后）；真实数据联调 **C-19/20 CODE_READY 后（P2）** |
| **FE-8** | frontend-dev 实现 / research-dev 复核 regime 标签 | M（约 1 agent-日） | Regime 标签可视化 + 报告导出（含 datasetVersion/strategyVersion/codeVersion 溯源）；标记「研究结论 vs 技术预览」 | 骨架可先做（FE-0 后）；真实标签联调 **C-22.1 CODE_READY 后（P2）** |
| **FE-9** | frontend-dev 实现 / research-dev 复核纪律语义 | L（约 2 agent-日） | 纸面交易全生命周期视图（建仓→加仓→做T→清仓）+ 纪律反馈看板 + 生产闭环状态；**标注「非研究可信度口径」隔离 legacy（R7）** | 骨架可先做（FE-0 后）；真实数据联调 **C-23/24/25 CODE_READY 后（P2~P3）** |

> **插入节点总则**：前端**骨架线**（页面/组件/图表/交互）自 FE-0 后即可并行（不依赖真实数据，空态/加载态先行，禁止 mock 冒充真实数据 §0.2）；**真实数据联调线**依赖对应后端 STEP 认证，与 P0/P1/P2 逐级对齐；FE-1~FE-4 覆盖数据/数据集链路（早于研究引擎），FE-5~FE-9 覆盖研究/回测/纪律链路（晚于研究引擎）。前端整体里程碑 = §48.1 P4。

### 与 legacy 页面的关系

- 现有 `Backtest.tsx`（组合回测）、`PaperTrading.tsx`（前向纸面交易）走 `server/backtest/` + `server/paperTrading.ts`，是 **legacy 工具，非研究链路**（§44.4 已标注 research-legacy 边界）。
- 新前端 UI 走研究链路（`server/research/`）：**短期并行、长期收敛**——FE-5/FE-9 落地后，逐步把 legacy 页面迁移到研究链路（或明确标注「非研究可信度口径」），避免两套口径混淆用户（风险 R7）。

### 前端整体验收标准（完成标志）

- **FE-0**：tRPC 契约编译通过 + 契约单测通过 + 前端 `trpc.ts` 类型安全调用。
- **每个页面**：`tsc --noEmit` 干净 + 组件单测 + 真实数据 smoke（非 mock）；空态/加载态/错误态齐备。
- **端到端**：用户可在 UI 走通「看数据域健康 → 查 asOf 状态 → 建数据集 → 定义策略 → 跑研究 → 看绩效 → 参数搜索/鲁棒性 → WFO/过拟合 → 复盘」，全程可审计、可复现（对齐 P3 端到端验收）。

---

# 49. 目录与模块命名规范（2026-09-07 定稿）

## 49.1 规则（强制，面向新增/修改代码）
1. **代码模块目录名禁止携带 STEP/C-task 编号或任何数字后缀**（robustness18、signal13 之类一律禁止）；使用纯语义小驼峰（camelCase），如：`signalEngine`、`costModel`、`executionConstraints`、`riskAdjustedMetrics`、`tradeQualityMetrics`、`parameterSearch`、`rollingOptimization`、`robustness`、`stochasticRobustness`、`walkForwardRun`、`oosIsolation`、`overfittingDetection`、`lifecycle`、`marketRegime`、`paperAccount`、`signalToPnl`、`researchDataset`、`datasetAccess`、`simulator`、`strategySchema`。
2. **模块文件（含 .test.ts）同样禁止携带任务编号**；测试文件与模块同主体：`<module>.test.ts`（如 `robustness.test.ts`）。
3. **STEP/C-task ↔ 模块映射由以下渠道承载，目录名不得重复承载**：目录头注释（`/** STEP xx / C-xx.y — … */`）、`server/research/index.ts` 统一出口注释、ROADMAP §44/§47 与 TASK_TRACKING 记录。
4. 例外（不受限）：`docs/` 下证据与日志产物（日期戳文件名、gate json 如 `research_ready_gate.json`）；`scripts/` 工具文件名；数据回填 CLI 参数。
5. 禁止为规避本规则引入编号/数字变形（如 `wfo2`、`copy3`）；名称必须取自职责语义。命名前先全库查重目录名与顶层符号（教训：`DEFAULT_LOT_SIZE` 重复导出 TS2308、`PaperPosition` 被 legacy 占用）。

## 49.2 历史追溯
2026-09-07 21:45 前的带编号目录名（signal13/costModel14/…/docs/step12-evidence）出现在 §47、TASK_TRACKING §5、memory 等 append-only 记录中，**不追溯改写**；以本节日期对应 §47 改名记录为映射对照（旧名 → 新名）。新增代码一律遵守 §49.1。
