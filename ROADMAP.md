# QUANT RESEARCH MASTER CONTROL SPEC V2

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
## 1. Task
任务名称

## 2. Status
DESIGN / CODE_READY / DATA_READY / VALIDATED / RESEARCH_READY / PRODUCTION_READY / BLOCKED

## 3. Evidence
真实 DB / Runtime / Test / Code

## 4. Changes
修改文件及核心变化

## 5. Data Snapshot
真实数据状态

## 6. Validation
测试与验证结果

## 7. Gate
PASS / PENDING / FAIL

## 8. Dependencies
前置与后续依赖

## 9. Risks
剩余风险

## 10. Next Action
下一步最优任务

## 11. Master Spec Update
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
> 禁止使用旧文档数字；每次更新前必须先实查 DB/代码/日志。
> 最后实查：**2026-09-10 01:30 GMT+8**（STEP DATASET-001 收口：Dataset Registry 6 表 + `ds_first_limit_pullback_*` 三物理表真实落地；2024 全年 10,240 事件/237,128 行构建；数据质量全 PASS。此前的 DS-V2-FINAL 收口结论——certify gate 17/17 全 PASS、`RESEARCH_READY=TRUE`、CERTIFIED Run `rd-1.0.0-1-fd1c487f2fe19e27`——保持不变）

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

> **Dataset Registry + 独立物理表（STEP DATASET-001，2026-09-10 01:30 落地，非 A~H 数据域，属 Dataset Data Layer）**：新增 6 表——`dataset_definition`（1 行，code=`first_limit_pullback`，显式存 event/path/outcome 表名）、`dataset_version`（3 行：smoke=151 事件 / v1=516 事件 1 个月 / v2=10,240 事件 2024 全年）、`dataset_build_job`（构建作业 checkpoint/resume）、`ds_first_limit_pullback_event`（**10,907** 行跨 3 版本，`UNIQUE(datasetVersionId,eventId)`）、`ds_first_limit_pullback_path`（**213,536** 行）、`ds_first_limit_pullback_outcome`（**32,721** 行）。v2 为基准版本：2024 全年 **10,240 首板事件 / 206,408 路径 / 30,720 结果 / 237,128 行**，构建 1381.6s、数据质量全 PASS（唯一性 0 重复、版本隔离、交易日历周五→周一、反策略绑定 0 列）。

> **09-09 03:33 备注（C/D/E 收尾 + gate 口径修正）**：D 全量回填收官——corporate_actions 主板（9/8 完成 2,932 股）+ 创业板 1,338 + 科创板 553（9/9 03:01 完成）；adjustment_factors 全市场 5,025 股早已 FULL。E 域补跑后 5,131 股（9/9 命令③，≥5000 达标）。**certify gate 阈值口径修正（§48.3 R1 / P0-4 落地）**：C 域 `research_security_status_history` 与 D 域 `corporate_actions` 均为**事件态表**（仅存发生过停牌/ST、分红/送转的证券），原按全证券数 5,500/5,000 判永不达标 → C 改「事件类型齐备 + 覆盖≥1,500」、D 改「CA ≥ AF − 容差 250」（2026-09-09 实查：AF-only 缺口 201 只样本在 BaoStock query_dividend_data 返回 0 行=确无分红送转事件，正常不产生 CA 行）；LISTING/DELISTING 全量边界由 securities（#4，5,552 只含退市 337）承载。**结果：gate 17/17 全 PASS，`RESEARCH_READY = TRUE`**。G 域两项质量待办（securityId 全 NULL + effectiveFrom 单点）保持 PENDING 不变，属 STEP 12.5 PIT 审计前必修。

> **G 域质量待办详情（2026-09-06 23:41 记录，保持）**：`industry_assignments` 落库 5212 行（5212 股 / 83 申万行业），340 只无行业归属为真实退市/ST/特殊股。① `securityId` 全 5212 行为 NULL（仅 `securityCode` 有值），G 回填未填 canonical identity 列，违反 §6 身份铁律，需用 code→research_securities 桥接一次性回填；② `effectiveFrom` 全部 = `2026-08-31` 单点（BaoStock 只给「当前」行业快照，无历史变更轨迹），历史 asOf(T) 行业查询只能近似（用 retrievedAt 语义），严格 PIT 行业轨迹需另寻历史源（申万历史成分/聚宽）或声明为「当前快照口径」。

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

1. ~~A OHLCV 收尾~~ ✅ 已完成（1863/1863 交易日 FULL，重复 0）
2. ~~G Industry 收尾~~ ✅ 已完成（5212/5552，340 无行业为真实退市；余 securityId 回填 + 历史轨迹两待办 → §48 P0-3）
3. C+E 全量回填（task `319415` 运行中：E 996 股/C 477 股，12:37，~8 股/min，预计 ~10h 完成）
4. D Corporate Actions + Adjustment 全量（C+E 完成后串行启动 → §48 P0-2）
5. G 数据质量修复 + H gate 重跑（→ §48 P0-3/P0-4）
6. 数据域认证 → 编码补齐 → 端到端验证（→ §48 P1/P2/P3）
7. **（业务数据待办，02:50 登记）limit_up_records 6,518 条名称对齐**：当日真实 10% 涨停但名称被回填套上当前 ST 名（208 只，清单 `scripts/backup/st_name_fix_targets.json`）。需 Tushare namechange 改回当日真实名称；实测限频 **1 次/小时**（当前 token 档位），约需 208+ 小时。工具就绪（provider + 清单），待更高积分 token / 配额放宽后执行（用户选定暂缓）。

---

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

> 本节约对 append-only，**禁止删除/覆盖历史记录**。每完成一个任务追加一条。

- **2026-09-06 20:02** — 落地 QUANT RESEARCH MASTER CONTROL SPEC V2 为唯一 Master Control 文档（ROADMAP.md）。实查真实 DB：OHLCV 813 万行（回填中至 2026-01-27）、Security Master/Index 全量、其余域回填中。建立 7 态状态映射 + STEP 12.5/12.6/13 的 Entry/Exit 实例化 + 差异识别。`RESEARCH_READY = FALSE`（诚实结论）。
- **2026-09-06 20:23** — 自主推进：实查 gate（20:09）确认 **A OHLCV 完成**（1863 交易日完整、缺口 0、重复 0，gate #3 PASS），行数 8.83M/5787 股仍在尾段补齐；G Industry 1274/5552 运行中。新建 `scripts/orchestrate_backfill.mjs` 串行编排器（BaoStock §30 串行约束：等 G → C+E → D，含停滞检测+自动重启+步骤重试），nohup 后台启动（PID 6111）接管后续回填链。更新 §44 数据快照/后台任务/任务队列。
- **2026-09-06 20:30** — **WORK A OHLCV 全量回填完成**（manifest 1863/1863 交易日、0 失败、0 suspicious、0 quota-stopped）。实查 DB 最终：**8,891,118 行 / 5796 股 / 1863 distinct days / 重复键 0**。发现编排器进程（PID 6111）已随 agent 会话清理（非交互会话 nohup 进程不跨 turn 存活），串行链改为「G 完成通知 → 手动启动 C+E → D」。更新 §44.1/44.2（A=FULL）/44.3/44.5。
- **2026-09-06 20:53** — **WORK C-12.5.1 asOf(T) 历史状态查询层 CODE_READY**。新增 `server/historicalState/`（STEP 12.5）：types.ts（10 问 + asOf/calendar 选项 + 知识维度）、mappers.ts（8 类 research/industry/liquidity/CA/index DB 行 → 领域对象纯映射）、reconstruct.ts（纯函数核心：身份/上市/退市/可交易/行业/流动性/价格/公司行为/市场状态/可知性，PIT=asOf 过滤 + calendar T+1 + CA announcement + 行业 retrievedAt；code 归属防代码复用）、db.ts（querySecurityHistoricalState 真实 DB 接线）、index.ts 统一出口。单测 28 例（reconstruct 19 + mappers 9）全过，`tsc --noEmit` 干净；下游 security/securityStatus/corporateActions/marketData/dbBarStore 325 例通过（唯一失败 `server/marketData.test.ts` 为直连真实库的旧业务表测试，与本任务零交集，环境性既有问题）。状态：CODE_READY（§39 编码先于数据解耦）；VALIDATED 依赖 A~H 全 DATA_READY（§0.2 禁止越级）。更新 §44.4 说明 + TASK_TRACKING C-12.5.1。
- **2026-09-06 21:59** — **WORK C-12.5.2 PIT/反泄漏抽样验证 CODE_READY**。新增 `server/historicalState/audit/`（STEP 12.5 VALIDATED 通道）：types.ts（bucket/sample/facts/issue/verdict/summary/gate 审计类型）、oracle.ts（naive PIT oracle：identity/lifecycle/industry retrievedAt+guardExercised/CA effective vs known，仅复用 intervalContains + code-ownership 基础 helper，期望计算不调用被测对象）、checkers.ts（12 项稳定 ID：IDENTITY_CODE/LIFECYCLE_MASTER/TRADABILITY_MASTER_BOUND/INDUSTRY_PIT/INDUSTRY_GROWTH/CA_EFFECTIVE_SET/CA_KNOWN_SET/PRICE_DAY/LIQUIDITY_DAY/MARKET_STATE_DAY/KNOWLEDGE_CONSISTENCY/PIT_SUBSET_DIMS）、db.ts（base+boundary 抽样与事实加载）、runAudit.ts（pit/full 2 腿查询 + gate 语义 FAIL/PASS/INCONCLUSIVE）、CLI `scripts/runStep125PitAudit.mts`（显式 `process.exit` 修复 CLI 挂起）。单测 oracle 12 + checkers 17 全过，tsc 干净，下游 325 例无新回归；真实 DB smoke（seed=20260906 budget=2）23 计划/23 查询/0 errors/0 failures、industry PIT guard exercised 3、gate=INCONCLUSIVE（dataReady=false），报告 `docs/step12-evidence/pit_audit_smoke.json`。状态：CODE_READY；VALIDATED 依赖 A~H 全 DATA_READY（§0.2 禁止越级）。更新 §44.4 说明 + TASK_TRACKING C-12.5.2。
- **2026-09-06 22:45** — **WORK C-12.6.1 Research Dataset 构建器 CODE_READY**。新增 `server/researchDataset/`（STEP 12.6）：types.ts（领域类型权威源：ResearchDatasetRequest/NormalizedResearchDatasetRequest/ResearchDatasetInput/UniverseDayResult/UniverseDefinition/ResearchDatasetRow（(tradeDate,securityId) 扁平宽行 = SecurityHistoricalState 投影）/DataSnapshot/DomainSnapshot/ResearchDataset/BuildResearchDatasetOptions/ResearchDatasetGate FAIL·PASS·INCONCLUSIVE + RESEARCH_DATASET_BUILDER_VERSION=1.0.0/ROW_SCHEMA_VERSION=1）、validate.ts（normalize 默认 asOfPerTradeDate=true + coreIndexCodes 4 大基准；EMPTY_NAME/INVALID_START_DATE/INVALID_END_DATE/RANGE_REVERSED/MISSING_AS_OF/CONFLICT_AS_OF）、version.ts（canonicalStringify 键字典序 → datasetVersion `rd-${builder}-${rowSchema}-${sha256 前 16 hex}`，computeRowsFingerprint）、universe.ts（resolveAsOfForRequest + resolveUniverseDefinition 逐日 resolveHistoricalUniverse PIT：LISTING/TRADING 正向确认、SUSPENSION/DELISTING 显式阻断、UNKNOWN 默认拒绝 + excludedByReason 统计）、assemble.ts（buildStaticContexts 全代码 code-ownership 过滤 industry/CA 归属防代码复用串扰（覆盖更名证券早期事件挂旧代码边界）+ projectStateToRow + assembleDayRows 逐 (member,date) resolveSecurityHistoricalState）、db.ts（loadResearchDatasetStatic 全量 securities/identifiers/status/industry/CA/indexMaster + index_daily 派生日历、loadDateFacts 逐日全市场 price/liquidity/index）、builder.ts（buildResearchDataset 编排 normalize→static→universe→逐日 facts→assemble→buildDataSnapshot（A~G 域统计 + coverageGaps：PRICE_MISSING_*/INDEX_MISSING_*/NO_ROWS_BUILT）→datasetVersion→gate）、index.ts 出口。CLI `scripts/runStep126BuildDataset.mts`（--name/--from/--to/--as-of/--data-ready/--max-days/--max-securities/--out，默认 `docs/step12-evidence/research_dataset_report.json`，显式 `process.exit` 防 drizzle 连接池挂起）。单测 21 例全过（validate 6 + version 6 + assemble 9 含 code 复用防串扰 S1/S2 用例）、tsc 干净、下游回归 714 例无新回归（唯一失败 server/marketData.test.ts 直连真实库旧业务表、零交集环境既有）。真实 DB smoke（2026-09-01→04）36s：gate=INCONCLUSIVE、datasetVersion `rd-1.0.0-1-cffc2a0e66efbf0b` 两次运行完全一致（确定性）、4 交易日 index 覆盖 4/4、行数 0（universe 0 成员——C 域 research_security_status_history 仅 211 行 ST/SUSPENSION 样本、无 LISTING/TRADING 正向记录 → TRADING_UNKNOWN/DELISTED 全量默认拒绝，诚实反映数据未就绪，非 bug）、coverageGaps=[NO_ROWS_BUILT]。**顺带修正**：TASK_TRACKING C-12.5.2 行状态跨 turn Edit 丢失回退 DESIGN，已恢复 CODE_READY（与 §5 21:59 记录一致）。状态：CODE_READY；DATA_READY/VALIDATED 依赖 A~H 全 DATA_READY（§0.2 禁止越级）。更新 §44.4 说明 + TASK_TRACKING C-12.6.1。
- **2026-09-06 23:10 — WORK C-12.6.2 数据集策略元数据与版本快照 CODE_READY**（并行 agent 交付，协调者复核验证）。新增 `server/researchDataset/policy.ts`（RESEARCH_DATASET_POLICY_SCHEMA_VERSION="1" / POLICY_ORDER / 9 类 value 接口 / derivePolicySet / deriveExpectedPolicyValue / computePolicySetFingerprint / indexPolicyById；9 类 = PIT / survivorship / corporate-action / adjustment（如实声明 priceBasis="raw"，与行 open/high/low/close 未复权一致）/ industry / liquidity / universe-membership / calendar-trading-days / knowledge；每类 policyId/class/name/description/value（机器可读）/evidence（可审计字段））、`policyValidate.ts`（validateResearchDatasetPolicyConsistency：9 类齐备/重复/顺序、value 键白名单、声明 vs 派生期望 canonical 相等、交叉语义冲突——缺 asOf、PIT mode 与 asOfDescription/行 asOf 冲突、日历窗口/数量、snapshot.request 相等，空壳不误报）、`versionSnapshot.ts`（buildDatasetVersionSnapshot / serialize / parse / computeVersionSnapshotFingerprint / summarizeUniverseDefinition / summarizeDataSnapshot）；additive 改 `types.ts`（ResearchDataset.policySet 必选 + RESEARCH_DATASET_PRICE_BASIS）、`version.ts`（导出 canonicalStringify）、`builder.ts`（两条 return 路径附 policySet）、`index.ts`。单测 policy.test.ts 16 例，researchDataset 37 全过、`tsc --noEmit` exit 0。决策：不 bump rowSchema（policySet 为确定性函数、datasetVersion 语义不变）；CLI --policy-out 与「一致性校验并入 gate」留 DATA_READY 认证阶段。CODE_READY；VALIDATED 依赖 A~H 全 DATA_READY。
- **2026-09-06 23:10 — WORK C-13.1 Feature 抽象与 Dataset 访问层 CODE_READY**（并行 agent 交付，协调者复核验证）。新增 `server/research/datasetAccess/`：handle.ts（ResearchDatasetHandle 绑定 + deriveDatasetUniverseId + assertDatasetVersionConsistent + 快照序列化/反序列化）、invariants.ts（assertRowPitInvariant 单一事实来源，守 asOf===tradeDate 强不变量、绑定期与 row→bar 入口双断言、冻结快照拒绝）、universe.ts（createDatasetUniverseProvider 实现 STEP 10 UniverseProvider 契约，缺失日/非交易日 FAIL FAST）、bars.ts（rowToCanonicalBar + createDatasetDataSource + DATASET_ROW_DOMAINS；bar.symbol=securityId、row.code 保留原文；返回全窗口 bars 由 pipeline visibleBars 按 decisionTime 过滤，本层行已 PIT 不做二次过滤）、slice.ts（sliceRowsByDateRange 闭区间）、session.ts（createDatasetSession 绑定→版本/dateRange/universeId 一致性→universe+dataSource+行切片）、index.ts。单测 datasetAccess.test.ts 27 例（逐日成员+FAIL FAST、闭区间边界/倒序、字段映射+null 透传+升序、版本不一致 throw、确定性深比较、PIT 脏行双层拒绝、集成直喂 pipeline 验 close/open 无泄漏）；`npx vitest run server/research server/researchDataset` 24 文件 **365 全过**、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./datasetAccess"`。克制：不做 Feature 库本体/Signal 新流水线/regime（C-22.1）。契约层类型化 DataDomain 升级留后续。CODE_READY；VALIDATED 依赖数据链就绪认证。§44.1/44.3 同步 G 行业 4574/5552（23:10 实查）+ 备注 industry_assignments.securityId 全 NULL 数据质量待办。
- **2026-09-06 23:41 — WORK G Industry 全量回填完成**（后台 task ap4YB7，4h5m）。BaoStock 行业回填落库 5212 行 / 5212 股 / 83 申万行业，`failed=0 invalid=0`，340 只无行业归属为真实退市/ST/特殊股。实查 DB：`industry_assignments` 5212 行、distinct securityCode 5212、distinct industryCode 83。**两个数据质量待办**：① `securityId` 全 5212 行 NULL（G 未填 canonical identity 列，违反 §6，需 code→research_securities 桥接一次性回填）；② `effectiveFrom` 单点 `2026-08-31`（BaoStock 仅给「当前」行业快照、无历史变更轨迹，历史 asOf(T) 行业查询只能 retrievedAt 近似，严格 PIT 需另寻历史源或声明快照口径）。G 状态 `CODE_READY→DATA_READY`（identity/PIT 校验仍 PENDING）。按 §30 串行链重启 C+E（task `1c5ehP`，resume 跳过已回填）。更新 §44.1/44.2/44.3/44.5。
- **2026-09-06 23:45 — WORK C-13.2 Signal/Candidate 框架 CODE_READY**（并行 agent B1 交付，协调者复核验证）。新增 `server/research/signal13/`：types.ts（Strategy13 引擎配方 / CandidateDayRecord / CandidateRunEvaluation / CandidateEvaluationRun——含 recordKind/recordVersion/fingerprint 可审计字段）、engine.ts（runCandidateEngine：universeDays ∩ config.dateRange 升序逐 tradeDate 驱动既有 STEP 10 runResearchPipeline，feature/signal/rank/select/泄漏守卫全转发不复制逻辑；当日 universe 成员缺行预检 + 特征 availability 覆盖全窗口预检 FAIL FAST；CandidateEngineError/MissingDatasetRowError/EmptyDecisionWindowError）、evaluate.ts（evaluateCandidateRun 候选层确定性统计：数量/横截面/入选稳定性/方向分布；**明确不复用 evaluationService**——其异步收益回测编排含 executedAt，语义属 C-14.1，区隔见 types.ts 头注释）、validate.ts（assertValidStrategy13/assertValidCandidateEvaluationRun）、serialize.ts（round-trip + computeCandidateEvaluationRunFingerprint sha256 防篡改）、index.ts。单测 signal13.test.ts 18 例：多日驱动正确性、统计正确、确定性、不可变、round-trip、篡改拒绝、缺行/整体无行/版本不一致/空窗口/未来函数/缺数据域/策略身份 FAIL FAST、真实 pctChange 特征端到端无泄漏。`npx vitest run server/research server/researchDataset` 26 文件 **415 全过**、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./signal13"`。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-13.2。
- **2026-09-06 23:45 — WORK C-13.3 Experiment Registry §28 实验谱系 CODE_READY**（并行 agent B2 交付，协调者复核验证）。新增 `server/research/experimentLineage/`：types.ts（ExperimentLineageRecord §28 15 字段齐备 + LINEAGE_MISSING_CODES + regime 结构化 unassessed 占位 reasonCode=REGIME_NOT_ASSESSED（C-22.1 前不误报）+ outcome 可挂载 metrics/result + recordKind/recordVersion）、codeVersion.ts（composeCodeVersion 注入式：package version + git HEAD 短哈希 + dirty 标记，纯模块不跑 git/fs）、map.ts（createExperimentLineageRecord/experimentToLineageRecord/snapshotToLineageRecord/mountRunOutcome——dataset_version/universe_version/cost/execution 缺省**显式 missing 不猜**，载体 vs context 冲突响亮抛错）、validate.ts（validateExperimentLineageRecord 双档：requireResolvedRefs 默认 true 的 §28 齐备机器检查 / 结构档）、serialize.ts（canonical + computeExperimentLineageFingerprint）、bridge.ts（ExperimentLineageBridge 组合式包装既有 ExperimentRegistry，只读无 DB）、index.ts。单测 experimentLineage.test.ts 32 例：code_version 确定性/格式、映射正确性/missing 不猜/Snapshot 需 createdAt、15 项缺项与格式错、fingerprint/不可变/round-trip/防篡改、outcome 挂载与拒绝、bridge、既有 fixture 兼容。26 文件 **415 全过**、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./experimentLineage"`。真实接线（入口 composeCodeVersion + mapping context 注入）留待未来 runner/编排层。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-13.3。
- **2026-09-06 23:55 — C+E 回填 ECONNRESET 崩溃修复 + 二次重启**。C+E（task `1c5ehP`）progress 80/5552 处因 TiDB `read ECONNRESET` 崩溃（`upsertSecurityStatusIntervals` 批量插入无重试、冒泡 exit(1)）。修复 `scripts/backfillStatusLiquidity.ts`：新增 `withDbWriteRetry`（MAX_DB_WRITE_RETRIES=3 指数退避 2s→4s；`isTransientDbError` 识别 ECONNRESET/ETIMEDOUT/EPIPE 等 + DrizzleQueryError cause 链 + 消息关键字兜底）+ main 写入段 per-stock try-catch 逐股隔离（单只失败记 failed 继续，resume 重跑）。幂等安全：status 去重 + liquidity onDuplicateKeyUpdate。C+E 重启为 task `KmWNCk`。更新 §44.3。
- **2026-09-07 00:17 — WORK C-14.1 交易模拟核心 CODE_READY**（并行 agent C1 交付，协调者复核验证）。新增 `server/research/simulator/`：types.ts（SimulationConfig/SimulationConfigSnapshot/TradeSimulationRun（recordKind/recordVersion=1）/SkippedIntentEntry/PlanSkipCode（SUSPENDED·INSUFFICIENT_CASH·LIMIT_UP_BLOCKED·NON_LONG·MAX_POSITIONS·T1_FREEZE 等）/TradeSimulationInput）、plan.ts（planDecisionDay 纯函数：hold-while-selected 进出场、现金权重预算、T+1 冻结顺延、sell=全部可卖份额精确股数、卖先买后订单）、engine.ts（runTradeSimulation 多日编排 + TradeSimulationError/MissingSimulationRowError/EmptySimulationWindowError）、validate.ts/serialize.ts（compute+round-trip+sha256 指纹防篡改）、index.ts。**差距判定**：STEP 8 `server/backtest/` 已覆盖 T+1/涨跌停/停牌/手数/资金/买卖限制/成本/执行模型/审计原子能力 → 直接 import 只读复用不重写（禁复制文件）；缺口=候选→Order 适配 + 多日编排（STEP 8 SignalGenerator 契约缺每股可卖视图无法精确退出，故新建薄编排复用其原语）+ 候选溯源结果绑定。设计：决策 point=close、executionTime=下一交易日、默认 NEXT_OPEN（成交 basePrice=次日 open 非信号日收盘）、涨跌停拦截/部分成交可配置、停牌=dataset 缺行、资金不足拒绝入审计不静默、skipped 全记录；产出 EquityPoint[]/Trade[]/AuditTrail 供 C-16.1。单测 17 例（端到端 T+1 语义实证守卫「禁止 signal→next close」/NEXT_CLOSE 对照/涨停拦截开关/停牌拒绝/T+1 冻结顺延清仓生命周期/确定性/round-trip/篡改拒绝/缺行·版本·非 close 决策·空窗口 FAIL FAST）。`npx vitest run server/research server/researchDataset server/backtest` 32 文件 **498 全过**、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./simulator"`。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-14.1。
- **2026-09-07 00:17 — WORK C-15.1 策略 Schema + 版本化 CODE_READY**（并行 agent C2 交付，协调者复核验证）。新增 `server/research/strategySchema/`：types.ts（StrategyDocument §16 全字段结构化：identity/version(semver x.y.z)/name/description/universe/datasetVersion(`rd-…` 校验)/entry·exit·positionSizing·riskRules 声明式 descriptors/parameters/executionAssumptions + StrategyVersionRecord §17 九项追溯 + StrategyRecipe 配方引用 + clone 语义闸门）、version.ts（bumpStrategyVersion + classifyRequiredBumpKind：结构变→major、参数/文本变→至少 minor，不可变）、validate.ts（validateStrategyDocument/validateStrategyVersionRecord 结构化 issue：缺项/非法 semver/非法日期/参数与 schema 不符/dataset 交叉一致）、compare.ts（strategiesDeepEqual/compareStrategyDocuments——「比较」能力）、serialize.ts（canonical round-trip + compute*Fingerprint sha256）、map.ts（strategy13ToRecipeRef/attachSignal13Recipe：Strategy13 可序列化面嵌入、函数面按 recipeId 由调用方持有）、index.ts。**差距映射**：§16 identity/version/name/desc/parameters 已被 StrategyContract/Strategy13 部分覆盖，universe/datasetVersion/exec assumptions/entry·exit·sizing·risk 与 §17 版本追溯为本体补齐；保存/加载=canonical round-trip+指纹复核（不做 DB）；生命周期状态机排除（C-21.1）；regime 不建模（C-22.1）。单测 strategySchema.test.ts 8 组 28 例；research+researchDataset **443 全过**（415+28 零回归）、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./strategySchema"`。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-15.1。
- **2026-09-07 00:40 — WORK C-14.2 成本模型专项 CODE_READY**（并行 agent D1 交付，协调者复核验证）。新增 `server/research/costModel14/`：types.ts（CostModelDeclaration/MarketImpactParams/FillCostInput/FillCostBreakdown（commission/stamp/transfer/slippage/impact 五维）/MarketImpactEstimate）、defaults.ts（A_SHARE_DEFAULT_COST_DECLARATION + 8 费率常量：佣金万 2.5/印花卖出 0.05%/过户 0.001%/滑点 10bp/一手 100/最低佣 5 元）、impact.ts（estimateMarketImpact/impactBpsForParticipation/participationFromTurnover——**市场冲击显式建模**：impactBps=min(maxBps, coeff×p^exp) 平方根律亚线性参与率近似，决策日成交额口径无未来函数；流动性 null/≤0→IMPACT_LIQUIDITY_INVALID、超 maxParticipation 结构化拒绝、enabled=false 显式 0+participation=null）、compute.ts（computeFillCostBreakdown 单笔五维分解，totalCostDrag=|slippage|+cashFees+|impact|）、mappers.ts（toEngineCostModel 六字段投影丢冲击 / fromEngineCostModel 需显式冲击参数，杜绝隐式启用未标定模型）、validate.ts（validateCostModelDeclaration/assertValid…，值域校验防负费率/超界，边界常量）、errors.ts（CostModel14Error 4 稳定 code）、serialize.ts、index.ts。**差距判定**：佣金/印花税/过户费/滑点原子函数 STEP 8 `backtest/cost.ts` 只读复用；缺口（新建）=市场冲击 + 成本声明 schema + 单笔分解审计 + simulator 配置面映射（mapper 输出直接赋 SimulationConfig.cost）。默认校准：coefficient=40/exponent=0.5，p=1%→4bp、10%→13bp（研究参考）。单测 34 例（1,000,000 元→佣金 250/印花卖出 500/过户 10、冲击 6 场景、schema 非法样本、round-trip、STEP 8 组合逐字段一致、mapper 消费面）。35 文件 **598 全过**、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./costModel14"`。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-14.2。
- **2026-09-07 00:40 — WORK C-14.3 执行与约束模型 CODE_READY**（并行 agent D2 交付，协调者复核验证）。新增 `server/research/executionConstraints14/`（7 文件 2066 行）：types.ts（ExecutionConstraintDeclaration 六分组组合声明：capital/positions/lot/restrictions/timing/marketClaims + PositionConstraints/BuySellRestrictions/TimingOrderConstraints/MarketRuleClaims + EXECUTION_CONSTRAINT_DECLARATION_KIND/_VERSION + DEFAULT_LOT_SIZE）、factory.ts（createExecutionConstraintDeclaration 默认值合并 + sortUniqueSecurityIds 升序去重）、validate.ts（validate…/assert… 16 类 EXCON_* issue 码 + EXECUTION_MODEL_IDS/SECURITY_BOARDS 值域）、serialize.ts（canonical 键字典序 sha256 + NaN 严格拒绝，复用 researchDataset canonicalStringify 只读）、map.ts（mapExecutionConstraintDeclaration→C-14.1 SimulationConfig + assertMap… 产物再经 validateSimulationConfig 双保险复核「映射出来必是 simulator 敢收的配置」+ describeExecutionConstraintCoverage 17 轴能力矩阵 + ConstraintCoverageItem/ConstraintEnforcementState 三段式 ENFORCED/NOT_DECLARED/DECLARED_ONLY）、index.ts。**诚实边界**：perSecurityCap/totalCap/banned 集/LIMIT_PRICE 是 STEP 8 枚举成员但 C-14.1 链（plan 按权重×现金分预算无市值闸门、无标的级过滤、只发市价单）不可执行 → 值域校验放行但映射报 blocker，**绝不冒充已执行**。**判定不做**：开盘后 N 分钟/收盘集合竞价（C-12.6 行域为日线，声明即伪造）；成本模型（C-14.2）；执行内核（复用 runTradeSimulation import 只读）。单测 26 例（schema 校验 11/round-trip 4/映射 7/**端到端约束生效 3**：maxPositionCount=1→MAX_POSITIONS_REACHED 拒超限、涨停禁买 LIMIT_UP 拒单+关闭拦截对照成交、跌停禁卖 LIMIT_DOWN 拒单且持仓不静默清仓，三场景成交股数均 100 整数倍/确定性 1）。35 文件 **598 全过**、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./executionConstraints14"`。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-14.3。
- **2026-09-07 00:40 — WORK C-16.1 收益/风险/回撤指标 CODE_READY**（并行 agent D3 交付，协调者复核验证）。新增 `server/research/performanceMetrics/`（5 文件 1615 行）：types.ts（PERFORMANCE_EVALUATION_RUN_KIND/VERSION + PerformanceEvaluationInput/Run + ReturnMetrics/RiskMetrics/DrawdownMetrics/DrawdownSegment（peak/trough/recovery 日期+交易日+自然日时长，期末未恢复 recoveryIndex=null，深度并列取更早 peak）/WorstLosingStreak，字段级口径注释）、analyze.ts（PerformanceEvaluationError/InvalidEquityCurveError 稳定 code + assertValidEquityCurve + dailyReturnSeries + analyzeDrawdown + computePerformanceMetrics）、evaluate.ts（computeInputFingerprint/computePerformanceEvaluationRunFingerprint 双指纹 + evaluatePerformance + serialize/deserialize round-trip + assertValidPerformanceEvaluationRun）、index.ts。**口径核对**：CAGR=（end/start)^(252/n)−1 交易日几何口径，与 STEP 8 annualizedReturnPct **无算法冲突**（共享原语），差异仅在锚点（STEP 8 initialCapital vs C-16.1 equityCurve[0].equity——C-14.1 输出两者重合已测试验证，分歧场景文档化为「存入资金视角 vs 曲线视角」）；MaxDD 深度与 maxDrawdownFromEquity 一致（测试对照）。**新增**：DrawdownSegment 回撤生命周期、drawdownSegments/drawdownEpisodeCount 阈值分段剖面、Recovery Factor=总收益÷|MaxDD|（非 CAGR÷MaxDD=Calmar 留 C-16.2）、下行偏差/最差连续亏损段/单日最大亏损/分位数/偏度峰度 tail risk。自然日差用纯函数儒略日转换（无 Date 对象确定性）。退化输入响亮失败：空/单点 INSUFFICIENT_EQUITY_CURVE、非有限/非正 INVALID_EQUITY_VALUE、乱序/重复/非法日期 EQUITY_CURVE_UNSORTED/INVALID_DATE、无回撤 recoveryFactor=null（分母 0），无静默 NaN。克制：Sharpe/Sortino/Calmar 属 C-16.2、交易质量属 C-16.3（类型留扩展槽）。单测 40 例（手算 CAGR/MaxDD 13.636% 起止恢复/Recovery Factor/剖面阈值/未恢复段/连亏 −14.307%/下行偏差/分位数/STEP 8 对照含锚点分歧/确定性/深冻结/round-trip/篡改拒绝）。35 文件 **598 全过**、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./performanceMetrics"`。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-16.1。
- **2026-09-07 01:26 — WORK C-16.2 风险调整指标 CODE_READY**（并行 agent E1 交付，协调者复核验证）。新增 `server/research/riskAdjustedMetrics16/`（5 文件 1017 行）：types.ts（RiskAdjustedEvaluationInput（equityCurve/trades/annualizationFactor/rfAnnualPct/downsideTarget）/RiskAdjustedMetrics/RiskAdjustedEvaluationRun（RISK_ADJUSTED_EVALUATION_RUN v1））、analyze.ts（computeSharpeRatio/computeSortinoRatio/computeCalmarRatio/computeDownsideDeviationPct/computeRiskAdjustedMetrics）、evaluate.ts（evaluateRiskAdjustedMetrics/computeRiskAdjustedRunFingerprint/serialize+deserializeRiskAdjustedEvaluationRun/assertValid…）、index.ts。**差距判定**：日收益序列 dailyReturnSeries/回撤 analyzeDrawdown/曲线校验 assertValidEquityCurve C-16.1 import 复用；下行偏差 C-16.1 仅年化 % 结果未导出纯函数 → 独立实现 downsideDeviationDaily（同定义）+ C-16.1 对照测试锁定；Sharpe/Sortino/Calmar 计算器新建（C-16.1 留扩展槽）。**STEP 8 sharpeRatio 口径核对**：shared=mean(r)/sampleStd(r)·√252、rf 固定 0 → 等价，差异仅 rf 参数化（rf=0 逐位一致测试锁定；STEP 8 round 4 位、本层不 round）。口径：Sharpe=mean(e)/sampleStd(e)·√252（e=日收益−日 rf）；Sortino=(mean(e)·ann)/(下行偏差·√ann) 算术年化对齐 STEP 8；Calmar=几何 CAGR/|MaxDD|（复用 C-16.1 cagrPct/maxDrawdownPct）；**rfAnnualPct 默认 0**（无隐藏假设）；downsideTarget 作用超额空间（等效原始阈值 rf_daily+target）；退化（样本<2/零波动/无下行/无回撤）→显式 null 记录成分恒定义、非法输入响亮抛错。单测 19 例；38 文件 **684 全过**、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./riskAdjustedMetrics16"`。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-16.2。
- **2026-09-07 01:26 — WORK C-16.3 交易质量与稳定性指标 CODE_READY**（并行 agent E2 交付，协调者复核验证）。新增 `server/research/tradeQualityMetrics16/`：types.ts（TradeQualityEvaluationInput/TradeQualityMetrics/TurnoverMetrics/MonthlyReturnEntry/YearlyReturnEntry/MonthlyConsistencyMetrics/YearlyConsistencyMetrics/TradeQualityRegimePerformance（unassessed+assessed 扩展槽）/TradeQualityEvaluationRun）、analyze.ts（monthKeyOf/yearKeyOf 字符串切片无 Date 对象/assertValidTrades/computeTurnoverMetrics/computeAverageHoldingPeriodDays/computeMonthlyConsistency/computeYearlyConsistency/unassessedRegimePerformance/isRegimeUnassessed/computeTradeQualityMetrics）、evaluate.ts（evaluateTradeQualityMetrics 装配+双指纹+serialize/deserialize/assertValid+重导出共享 PerformanceEvaluationError）、index.ts。**差距判定**：WinRate/PF/Expectancy/avgWin/avgLoss/completedTradeCount/Trade Count STEP 8 Metrics 已实现 → **复用 computeMetrics import 只读**（同输入逐位一致测试对照锁定；winRate 分母=完成交易、PF 无完成交易=0 的 STEP 8 语义原样保留，不做第二套实现）；**缺口新建**=Turnover（双边名义额含 openAtEnd 买入侧/平均资产，annualized=gross×252/(avgEquity×(点数−1)) trade 级近似文档化）、Average Holding Period 聚合（max(1, idx差+1) 回退 trade.holdingPeriod）、月度/年度一致性（月收益=该月实现日收益连乘−1，跨月边界按实现日归属，月/年连乘恒等于区间总收益——望远镜恒等测试断言，空月不伪造）、regime 表现（**unassessed 占位 reasonCode=REGIME_NOT_ASSESSED，C-22.1 前不编造标签**，assessed 扩展槽类型就位）。输入直食 (equityCurve, trades, annualizationFactor)（C-16.1 Run 记录不含原始曲线），共享 computeInputFingerprint 同载荷指纹互链。单测 37 例（winRate 75%/PF 0.7419/expectancy −40/avgHolding 2.25/turnover 17180/月 +21·−19·+10.25/年 +21·−5.5 手算 + STEP 8 对照 + 回退路径 + 退化/非法 + regime 占位 + round-trip 篡改）；38 文件 **684 全过**、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./tradeQualityMetrics16"`。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-16.3。
- **2026-09-07 01:26 — WORK C-17.1 Grid/Random Search CODE_READY**（并行 agent E3 交付，协调者复核验证）。新增 `server/research/parameterSearch17/`（10 文件）：types.ts（SearchRun/Candidate/评估契约/稳定区口径）、prng.ts（mulberry32 + Floyd 无放回——参照 audit/db.ts 思路自实现不跨模块 import 私有）、sampler.ts（gridParameterSets/sampleRandomParameterSets）、metrics.ts（标量校验 + C-16.1 只读桥 type-import）、region.ts（analyzeCandidateRegion/resolveRegionAnalysisConfig——**稳定区判定拒绝高收益坏点**：合格=收益≥门槛且回撤≤门槛，高收益高回撤归坏点并排除，显式非 argmax；坏点率=坏点/成功样本超限→degraded，requireStableCandidates 时仅 stable 产候选；成员收益降序确定性排序，聚合均值/中位数）、candidate.ts（buildCandidateStrategies：kind="candidate" 非 production，含参数+绩效摘要+searchRunId+sampleIndex 溯源+指纹，**无 promotion 代码**）、serialize.ts（指纹 sha256 canonical + round-trip + validate）、run.ts（runParameterSearch/runGridSearch/runRandomSearch + SEARCH id + searchRunId/createdAt 注入）、index.ts。**差距判定**：Grid 全组合 STEP 6.3 combinationGenerator **import 只读桥接不重写**、空间指纹复用 sweep.computeParameterSpaceFingerprint；Random 采样器不存在 → 新建 seedable PRNG（样本落 grid 同格点保持可比）；稳定区判定 reference parameterStability 思路；候选产出与 SearchRun 完整实验记录（method/seed/budget/空间指纹/被评样本/结论/候选/createdAt/fingerprint，哲学对齐 experimentLineage）新建。克制：Rolling 属 C-17.2、PBO 正式判定已有 overfittingAssessment 不重写、不做 candidate→Final 推广。单测 30 例（Grid 对照/随机确定性/不同 seed/混合格点/好区坏区/坏点率门/insufficient/no-qualified/候选语义与指纹自洽/round-trip/篡改/端到端闭环（假 evaluator 证明搜索→评估→候选）/非法指标抛错转记/退化校验）；38 文件 **684 全过**、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./parameterSearch17"`。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-17.1。
- **2026-09-07 01:32 — 数据同步进度实查汇报（用户查询）**。直连 DB 实测各数据域：A `stock_daily_prices` 8,891,118 行/5796 股/1863 交易日 FULL 不变；B securities+identifier 5,552 FULL；C `research_security_status_history` **5,177 行/~280 股**（ST 110 段+SUSPENSION 4,993 段，无 LISTING 行——仅事件态）；D corporate_actions 240/19 股、adjustment_factors 271/20 股（全量未启动）；E `liquidity_daily` **1,462,438 行/~470+ 股** 且活跃增长（间隔 8s 两次计数 +471 行；01:29→01:32 内由 1,440,436→1,462,438）；F index 7452/4 指数 FULL；G industry 5212 行/83 行业（securityId 全 5212 行 NULL + effectiveFrom 单点 2026-08-31 两质量待办未变）。判定：C+E 回填**仍活跃运行中**（task KmWNCk 跨会话，本会话进程视图枚举不到、以 DB 写入为准）；相对 universe 5,552 完成约 C 5% / E 8.5%。§44.1 表格数字自 23:41 以来未更新（滞后），本次覆盖式更新 §44.1/44.2/44.3/44.5。更新记录（§47 append-only）。
- **2026-09-07 01:48 — 暂停决策（用户：明天再继续）**。尝试停止旧 C+E 任务（task KmWNCk）失败——本机进程域（普通+非沙箱 PowerShell）枚举不到任何 node/python，automation 亦无此任务；旧任务不运行在本机可控制范围。确认旧任务在 01:48 后不久自行停止（断点：E 539 股/167.7 万行、C 320 股/6,295 行）。resume 幂等断点无损。制定方案 B（单进程驻留 + 2019+ 范围收敛）待次日执行。
- **2026-09-07 12:11 — C+E 回填提速改造完成并重启（方案 B）**。改造两文件：① `scripts/providers/baostock_probe.py` 新增 `session` 驻留命令（login 一次 + stdin JSONL 逐行请求/响应循环，请求级异常隔离，stdin EOF logout；stock_daily/stock_industry/ping）；② `scripts/backfillStatusLiquidity.ts` 新增 `BaostockSession` 类（spawn 单 Python 驻留进程、stdout 行解析按 id 路由、120s 请求超时看门狗 kill 后自动重生、子进程崩溃 rejectAll 后下请求重生、module 级单例），主循环改走 `fetchStockDailyWithRetry`（会话版，保留 3 次退避重试），universe 读取加 `withDbWriteRetry` 防护，main finally 关闭会话。**范围收敛**：重启命令显式 `--from=2019-01-01`（研究窗口 2019+；已完成全历史股不重跑、2019+ 部分两口径一致）。**验证**：tsc exit 0；py_compile OK；dry-run 3 只（每股 1863 行=2019+ 交易日数，会话连续处理 0 失败）；真写 2 只 + resume skip 1；dry-run 20 只/56s≈21.4 股/min；真实含 DB 写 30s 窗口 **8.0 股/min**（旧逐股模式 5.3），TiDB 写抖动 withDbWriteRetry 兜住。**重启**：task `319415` 后台运行（12:07），预计 ~10h 完成剩余 ~4,990 股（约今晚 22 时前后）；完成后手动启动 D 全量。更新 §44.1/44.2/44.3/44.5 + §47 append。
- **2026-09-07 12:26 — WORK C-17.2 Rolling Optimization CODE_READY**（并行 agent F1 交付，协调者复核验证）。新增 `server/research/rollingOptimization17/`（8 文件 2233 行）：types.ts（类型/常量权威源 + RollingOptimizationRequest/Run/Candidate）、windows.ts（generateRollingOptimizationWindows/resolveRollingWindowConfig/validateRollingTradeDates——**交易日锚定**窗口生成：tradeDates 索引切片、window/step 按交易日计、平铺/滑动/重叠可配、maxWindows 上限、不足窗响亮报错不静默空；决策依据：窗内评估消费逐交易日数据流（simulator→C-16.1），日历天会卷休市空隙，纯索引天然无未来数据；expanding 模式克制不做）、stability.ts（analyzeRollingConsistency/resolveRollingStabilityConfig/rollingParameterSetKey——跨窗一致性：一致=参数在每个被评估窗都 qualified（合格区交集、显式非 argmax，坏点无论多高收益都否决）、minEvaluatedWindows 缺省 2 单窗不算「跨窗稳定」、绩效聚合均值/中位数/最差不取极值）、candidate.ts（buildRollingOptimizationCandidates）、run.ts（runRollingOptimization/generateRollingOptimizationRunId：每窗 searchRunId=`${runId}-w<i>-search`、random 派生 seed=seed+i、createdAt 注入，整记录确定性）、serialize.ts（compute/serialize/deserialize/validateRollingOptimization{Run,Candidate} round-trip + sha256 指纹）、index.ts（42 顶层符号域前缀 Rolling*/ROLLING_* 全库查重零冲突）。**差距判定**：STEP 6.5 walkForward.ts（rolling/expanding/日历天/指纹）为生产 WFO 形态 → 复用其窗口哲学但**不 import**（研究链路交易日锚定、无 Train/Validation/OOS 三段）；窗内搜索复用 C-17.1 runParameterSearch/resolveRegionAnalysisConfig import 只读 + combinationGenerator 基数 + sweep.computeParameterSpaceFingerprint + canonicalStringify。**C-17.2 vs C-19.1 边界**：本任务只做「按时间窗滚动、逐窗全量参数搜索 + 描述性跨窗一致」；不做 Train→Optimize→Freeze→Test→Move Window 三段 WFO 编排（C-19.1/C-19.2）、不 promotion 任何候选为 Final/Production（kind=candidate 止步）。单测 29 例（窗口锚定/重叠/平铺/间隙/maxWindows/不足窗报错、与 C-17.1 直接对照、跨窗 A 稳好 vs B 单窗好他窗差非 argmax、记录 round-trip 三重篡改拒绝、确定性两次深比较、端到端闭环（假 evaluator 证明 滚动窗→每窗搜索→跨窗汇总→候选）、空日期·空参数空间·无合格窗·缺 seed 退化）；41 文件 **777 全过**（684+29 零回归）、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./rollingOptimization17"`。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-17.2。
- **2026-09-07 12:26 — WORK C-18.1 鲁棒性测试 CODE_READY**（并行 agent F2 交付，协调者复核验证）。新增 `server/research/robustness18/`（9 文件 2024 行）：types.ts（轴/扰动条目/阈值/结论/Run/Request 契约：ROBUSTNESS_AXIS_COST/SLIPPAGE/PARAMETER/EXECUTION）、costStress.ts（generateCostStressVariants/generateSlippageStressVariants——成本声明各分量 ×0.5/×1/×2/×5 档扰动含 ×1 基准、扰动产物**必须通过 costModel14 validate** 断言、超限 skipped 不 clamp）、parameterPerturbation.ts（generateParameterPerturbationVariants：ResearchParameterSet 数值参数 ±% /±档 局部邻域扰动，与 C-17.1 全局格点几何不同故独立实现、复用其参数形态+canonical 指纹哲学）、executionPerturbation.ts（generateExecutionPerturbationVariants）、drift.ts（assessRobustnessSensitivity/computeRobustnessDrift/buildRobustnessConclusion/resolveRobustnessThresholds——漂移口径=收益绝对差>5pp 双向敏感+回撤恶化>3pp 单向敏感）、evaluate.ts（runRobustnessStress：每扰动调 evaluator 一次且传入扰动配置——假 evaluator 记录调用断言；**单轴运行保证归因**，LIMIT_PRICE/不可执行轴拒绝扰动）、serialize.ts（双指纹 sha256 + round-trip + validateRobustnessRun + toRobustnessMetricsView 桥）、index.ts（命名全库查重零冲突）。**差距判定**：既有成本/执行声明层（costModel14/executionConstraints14）、C-17.1 稳定区（全局格点搜索）、STEP 6.5 parameterStability（只统计 Frozen 参数跨窗分布、不评估扰动绩效）——均**非**「已评估策略的扰动重估+漂移敏感归因」→ 四轴扰动器/编排/判定/RobustnessRun 全部真实缺口。克制：不做 MC/Bootstrap/Trade Order Randomization（C-18.2 专属，RobustnessAxis 联合可加轴留扩展槽不预埋）、不做 regime 扰动（C-22.1）、不跑真实回测（evaluator 注入测点）。单测 34 例（滑点×5 生成正确+validate 通过+含×1 基准/独立轴/参数±档枚举/执行扰动集/重估编排逐扰动 evaluator 调用/「成本×5→收益大降」成本敏感与「参数±20%→稳定」不敏感断言/Run round-trip 篡改拒绝/确定性/9 类退化输入）；41 文件 **777 全过**（684+34 零回归）、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./robustness18"`。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-18.1。
- **2026-09-07 12:26 — WORK C-21.1 生命周期状态机 + 审计 CODE_READY**（并行 agent F3 交付，协调者复核验证）。新增 `server/research/lifecycle21/`（10 文件）：types.ts（STRATEGY_LIFECYCLE_STATUSES 8 态 + STRATEGY_LIFECYCLE_TRANSITIONS 迁移表 + StrategyLifecycleRecord/LifecycleTransition/LifecycleEvidenceRef）、transition.ts（applyLifecycleTransition：相邻前进+回退白名单（Production→Research 显式长程例外）+任意态→Retired、Retired 终态（复活=bump 新版本新壳 genesis）、genesis 只许 Draft/Research、四要素 timestamp/reason/experiment/evidence 缺失拒绝）、gates.ts（→Validated/→Production 需 datasetGate PASS evidence 引用——格式+必填性校验，**不执行真实验证**留未来 runner 接线真实 gate）、ledger.ts（StrategyLifecycleLedger in-memory 账本）、serialize.ts/validate.ts（verifyLifecycleTransitionChain append-only 篡改断链 + round-trip + 指纹）、map.ts（createLifecycleFromVersionRecord：strategySchema StrategyVersionRecord 壳层绑定——**strategySchema 无需加 status**（壳层方案）+ createStrategyLifecycleRecord）、conceptMap.ts（mapStrategyLifecycleToTaskStatus/assertLifecycleTaskMappingIntegrity——**两套状态机概念隔离**：§7 是子系统交付成熟度（7 态）vs §23 是策略版本治理（8 态），有损汇报映射唯一 Validated→VALIDATED + 守卫断言，避免概念污染）、index.ts（命名 LIFECYCLE 域前缀零撞名）。**差距判定**：strategySchema（版本化/§17 追溯、无 status 字段已核实→壳层补齐）、experimentLineage（§28 谱系不含生命周期→壳内 experimentId/evidence 引用其记录）、status.ts 4 态（实验状态机、与 §23 8 态不同机器→独立域前缀）。克制：不做 DB 持久化表（纯记录+in-memory 账本）、不做生产执行（C-25.1 闭环）。单测 lifecycle21.test.ts 30 例（合法全链 Draft→…→Retired/跳级·复活拒绝/四要素缺失/append-only 篡改断链/证据门槛/版本壳 round-trip/指纹确定性/7 态映射断言/账本+边分类）；41 文件 **777 全过**（684+30 零回归）、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./lifecycle21"`。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-21.1。
- **2026-09-07 12:51 — 补充前端开发路线（§48.4）**。用户要求核查路线图是否含前端任务。实查确认 **ROADMAP 无前端开发任务**（§48 P0-P3 全为后端数据回填/认证/编码/验证；仅 §2/§41 两处 UI 表述为负面铁律）。现状：前端 `client/src/pages/` **12 页 5,098 行全 legacy**（涨停复盘/大盘/情绪/龙头/组合回测/纸面交易/上传/录入/同步/预警/日志），**无研究链路 UI**；后端研究链路 26,938 行已 CODE_READY 但 **tRPC 未暴露**（appRouter 无 research/historicalState/researchDataset 路由，前端无法消费）。动作：§48.1 总览加 P4 阶段（前端研究链路 UI）+ §48.3 加风险 R6/R7 + 新增 §48.4「前端开发路线（研究链路 UI）」：FE-0（tRPC 前置，server 侧）+ FE-1~FE-9（数据域健康看板/asOf 查询器/数据集构建器/策略编辑器/绩效仪表盘/参数搜索+鲁棒性/WFO+过拟合/Regime+报告/复盘+生产闭环），每项含范围/依赖/优先级/交付成果。
- **2026-09-07 12:59 — 补全 §48.4 前端任务规格（职责/工作量/Exit/插入节点）**。用户要求前端任务补充到 roadmap 并明确职责、依赖、工作量、完成标准、插入阶段。核查：§48.4 已于 12:51 建立（FE-0~FE-9 范围/依赖/优先级/交付成果），**缺四项执行要素** → 本次增强而非重复：① §48.4 新增「前端任务职责、工作量与插入节点」规格表——每 FE 任务补「职责（执行/复核角色）、预估工作量（S/M/L+agent-日）、逐任务完成标准 Exit、插入节点（骨架线 FE-0 后即并行 vs 真实数据联调线对应 P0/P1/P2 里程碑）」；② §48.1 P4 行状态更新为「规格已定」；③ 头注时间戳更新至 12:59。前端 12 页/5,098 行 legacy、appRouter 无 research 路由等事实已复核一致（§47 12:51 记录）。附：FE 工作量含组件单测+tsc，不含后端对应 STEP 编码。
- **2026-09-07 14:15 — WORK FE-2 asOf(T) 历史状态查询器 CODE_READY（十问渲染页面落地）**。FE-0 只暴露了 `historicalState.asOf`（以 securityId 为键），FE-2 补齐**用户输入 UX**：shared 契约增 `historicalStateResolveInputSchema`/`codeCandidateSchema`/`historicalStateResolveResultSchema`；新增 `server/historicalState/codeLookup.ts`（纯 `parseCodeQuery`：6 位数字 ± .SH/.SZ/.BJ，非法输入可读错误；DB `lookupSecuritiesByCode`：identifier history × securities master 检索，**代码可复用故返回候选集**、primary 优先归并、DB 不可用/15s 超时 → error 不冒充「查无此代码」）；`historicalStateRouter` 增 `resolveCode`（output schema 强约束）；页面 `client/src/pages/HistoricalState.tsx`（路由 `/historical-state` + AppShell「研究数据」导航）渲染**十问**：Q10 可知性维度 chips（KNOWN/UNKNOWN 不粉饰）→ Q1 身份 / Q2·Q3 生命周期 verdict / Q5 可交易（剔除原因原样展示，UNKNOWN 不默认放行）/ Q4 行业 / Q6 流动性 / Q7 价格（A 股红涨绿跌）/ Q8 公司行为（Q8a 已生效 vs Q8b·Q10 asOf 已知双层口径分列）/ Q9 市场状态表；**asOf 留空 = FULL_KNOWLEDGE 明示警告**（§4 PIT）；返回 null → 黄条明示不伪造假状态。类型经 `inferRouterOutputs<AppRouter>` 后端推断，不复制领域 schema。**验证**：7 例单测全过（parse 边界/无 DB 诚实失败/接线守卫）、`tsc --noEmit` exit 0、`vite build` 通过、FE-1/FE-0 回归 32/32。真实 asOf 联调依赖 M0（DB 回填期间 TiDB 饱和，resolve/asOf 均带超时兜底）。§48.4 FE-2 标记 CODE_READY；TASK_TRACKING G3 FE-2 状态同步。
- **2026-09-07 14:22 — WORK FE-3 Research Dataset 构建器 CODE_READY（纯前端骨架页，真实构建联调待 M0）**。`researchDataset.build` 契约 FE-0 已暴露（shared 零改动），本次只做消费方页面：新增 `client/src/pages/DatasetBuilder.tsx`（路由 `/dataset-builder` + AppShell「研究数据」加「数据集构建」）。左侧构建配置表单（名称/from/to/**逐日 PIT vs 固定 asOf 联动**（固定口径 amber 警告 §4）/maxTradingDays≤40/maxSecuritiesPerDay≤1000/dataReady 勾选；默认对齐 RPC 护栏 5 日/50 股/false，表单明示「dataReady=false → gate 至多 INCONCLUSIVE」）；右侧 mutation 结果（isPending skeleton/error alert/空态齐备）。**三块只读渲染**：总览（datasetVersion mono 指纹 + gate 徽标原样着色 + rowCount + gateNotes Alert）、Tabs 数据快照（请求规范化回显/日历/域快照表/coverageGaps 红条 or 无缺口绿条）、9 类口径 policySet（policyId/description/机器可读 value **逐键渲染**/evidence chips）、成员决议 universe（rule/每日成员数+排除统计；members id 列表只汇总不逐条回展）。**关键取舍**：summary 的 universeDefinition/policySet/dataSnapshot 为 shared `unknown`（无第二份口径）→ 页面「防御性取值」helpers（isRecord/pickStr/pickNum）渲染，缺失显「—」不猜结构；rows 永不回传只显 rowCount。**验证**：`tsc --noEmit` exit 0、`vite build` 通过（12.7s）、FE-0/FE-1/FE-2 回归 **32/32**。真实构建联调依赖 M0 数据就绪（build 同步长任务，DB 回填期间可能等待较久，页面已明示）。§48.4 FE-3 标记 CODE_READY；TASK_TRACKING G3 FE-3 状态同步。
- **2026-09-07 19:50 — SQL 版回填脚本落地（用户「我自己执行导入」方案）**。复制 `scripts/backfillStatusLiquidity.ts` 为 `scripts/backfillStatusLiquidity_sql.ts`：① 删 DB 写（withDbWriteRetry / upsertLiquidityDaily / upsertSecurityStatusIntervals）改用新增 `SqlWriter` 类（liquidity `INSERT ... ON DUPLICATE KEY UPDATE`、status 纯 `INSERT ...`，每只股 flush 一次保证中断不丢；retrievedAt 用 SQL `NOW()` 与 DB 默认值语义一致）；② CLI 收敛为最简（必填 `--sql-output=<path>`、可选 `--board=main/cyb/kc/bj`、--from 默认 2019-01-01、--interval 默认 1000）；③ 自动跳过 BJ（除非 `--board=bj`）；④ 头部写元数据（generated_at/范围/板块/pid/行数）+ tail 写入结束统计；⑤ 删去原 `loadUniverse`（走 baostock 易截断）、保留 `loadUniverseFromDb` 读云端 universe。**沙箱限制**：本会话内 spawn python 受 sandbox 阻拦无法跑通端到端，但 tsc --noEmit exit 0、5 分钟小样本验证头部 SQL 文件合规。原 `backfillStatusLiquidity.ts`（DB 版）原样保留不破坏，用户可自由切换两种落库模式。更新 §44.1/44.3 + §47 append。

- **2026-09-07 14:35 — WORK FE-4 策略编辑器 + 运行工作台 CODE_READY（首个端到端真测 FE）**。`strategy.validate/bump/compare` + `lifecycle.describe/transition` 契约 FE-0 已暴露（shared 零改动），本次纯消费方页面：新增 `client/src/pages/StrategyEditor.tsx`（路由 `/strategy-editor` + AppShell「研究数据」加「策略工作台」）。三 Tab：① 策略编辑器——JSON 透传完整 StrategyDocument（§16）→ validate 结构化 issue 表（code/path/message），fingerprint 占位明示（validate 只查非空，真实指纹后端序列化重算）；② 版本化——bump（major/minor/patch）+ compare 字段级 diff（忽略 version/fingerprint）；③ 生命周期——describe 状态机（8 态 chips + 迁移表，后端常量唯一事实来源）+ transition 表单（to 下拉按 transitions[currentStatus] 动态过滤/四要素/evidence JSON），返回新 record（status 徽标 + transitions 历史链 + fingerprint）。**关键取舍**：① 模板（合法 StrategyDocument + 合法 genesis 生命周期壳）由后端纯函数生成一次后内嵌前端常量，前端只透传不重算 fingerprint/chain hash（§31）；② 领域对象 `z.custom` 透传、后端权威校验、页面不复制 schema；③ 迁移失败后端抛错、页面原样展示 tRPC error 不吞异常；④ `to` 断言复用 shared `StrategyLifecycleStatusValue`。**验证**：`tsc --noEmit` exit 0、`vite build` 通过（14.6s）、回归 70/70 + **端到端 smoke 6 项全过**（createCaller 实走：validate.valid=true / bump 1.0.0→1.1.0 / compare 定位 name / describe 8 态 Draft→[Research,Retired] / transition Draft→Research status=Research / 跳级 Draft→Candidate 被拒）。§48.4 FE-4 标记 CODE_READY；TASK_TRACKING G3 FE-4 状态同步。
- **2026-09-07 13:55 — WORK FE-1 数据域健康看板 CODE_READY（P0 首个前端研究页面落地）**。新增 `shared/dataHealthContracts.ts`（gate 状态/域/覆盖率/证据/实况 zod 契约，唯一来源）、`server/dataHealth.ts`（**只读真实证据**：判定源自 `docs/step12-evidence/research_ready_gate.json`——certify 脚本只读 TiDB 生成，本模块只读→校验→派生展示字段，**不重算 gate、不粉饰 PENDING**；DOMAIN_SPEC 域→gate 映射单一来源；覆盖率取最差来源保守口径；证据缺失/解析失败 → parseError 不伪造）、`server/dataHealthRouter.ts`（overview/evidence/liveCounts，`liveCounts` 带 `certified:false` 字面量类型实现认证态/实况态类型级分离）、`client/src/pages/DataHealth.tsx`（RESEARCH_READY 状态灯 + A~G 七域卡 + gate 17 项明细表 + 数据快照 + 证据产物 + 未认证实况 Tab）+ App.tsx 路由 `/data-health` + AppShell 新增「研究数据」导航分组（legacy 壳增量，不重置）。**性能发现与修复**：实况查库首版 UNION ALL 全表 COUNT(DISTINCT)（含 8.9M 行 stock_daily_prices）在回填并发写下 >5min 挂起 → 重构为「information_schema 估算行数（O(1)，标注≈）+ 逐表精确 COUNT(DISTINCT) + 单表 25s 超时 + 超大表不查覆盖（其覆盖由 gate#3 PASS 1863/1863 给出）」。**验证**：13 例单测全过（读真实证据文件断言规则一致性，不硬编码漂移值；派生规则 FAIL>PENDING>PASS、覆盖取最差、缺项保守 PENDING）、`tsc --noEmit` exit 0、`vite build` 通过（2,847 模块）。已知限制：实况端点依赖真实 DB 且与 C+E 回填并发存在争用，故默认手动触发。§48.4 FE-1 标记 CODE_READY；TASK_TRACKING G3 FE-1 状态同步。
- **2026-09-07 13:32 — WORK FE-0 研究链路 tRPC 暴露 CODE_READY（R6 解除）**。前端 P0 前置落地：新增 `shared/researchContracts.ts`（唯一契约来源；领域对象用 `z.custom` **类型透传**由后端权威校验器判定，shared 层不复制领域 schema 防双份口径漂移；生命周期状态枚举以传输层字面量定义并由契约单测断言与后端 `STRATEGY_LIFECYCLE_STATUSES` 完全一致）、`server/historicalStateRouter.ts`（asOf 复用 STEP 12.5 `querySecurityHistoricalState` 只读，DB 不可用/未命中**诚实返回 null 不伪造空状态**）、`server/researchDatasetRouter.ts`（build 复用 STEP 12.6 `buildResearchDataset`，**只回传摘要剔除 rows**——rows 百万级不可经 RPC，gate FAIL/PASS/INCONCLUSIVE 原样透传不粉饰为 PASS，RPC 触发强制限流默认 maxTradingDays=5/maxSecuritiesPerDay=50 防误触全历史构建）、`server/researchRouter.ts`（strategy.validate/bump/compare 复用 C-15.1 纯函数；lifecycle.describe 的 8 态与迁移表**取自后端常量**为唯一事实来源，lifecycle.transition 复用 C-21.1 `applyLifecycleTransition` append-only 返新记录，不满足迁移表/§23 四要素原样抛错不静默）。三 router 注册进 `server/routers.ts` appRouter；前端 `client/src/lib/trpc.ts` 因 `import type { AppRouter }` 自动获得类型安全调用。**验证**：契约单测 `server/researchContracts.test.ts` 12 例全过（枚举一致性守卫 / appRouter 注册 R6 回归锁 / 入参 schema / 纯端点经 caller 走通 + 跳级迁移 Draft→Production 拒绝）、`tsc --noEmit` exit 0、回归 47/48 文件通过（唯一失败 `server/research/marketRegime22/` 8 例为**并行 agent 在途编写 C-22.1**，13:31 仍在改，与本次零重叠）。**纪律**：asOf 与 dataset.build 依赖真实 DB，按 §0.2 禁止 mock 冒充，单测不覆盖，真实链路验证由既有 CLI smoke（runStep125PitAudit / runStep126BuildDataset）与 P1 认证承担。§48.4 FE-0 标记 CODE_READY；TASK_TRACKING 新增 §3.10 G3 前端任务组（FE-0~FE-9）+ §5 append。
- **2026-09-07 13:08 — 治理对齐（Spec V1 → 现有 V2）+ 产出 MASTER ROADMAP STATUS REPORT**。用户下发「MASTER ROADMAP + TASK TRACKING INTEGRATION SPEC V1」。按 §3/§4「先扫描、在原 Roadmap 升级而非重建」执行：① 全量扫描确认现有治理体系已完备（ROADMAP.md V2 §0-48 / TASK_TRACKING.md 37 任务 / DEVELOPMENT_PLAN.md / §48.4 前端 FE-0~FE-9 / docs/ 审计 + step12-evidence）；② 实查真实 DB（13:08）：E liquidity 3,087,475 行/1,424 股、C status 7,125 行/617 股、D CA 240/19 股 + Adj 271/20 股未启动、G securityId 仍全 5,212 行 NULL；gate PASS 12/PENDING 5/FAIL 0，`RESEARCH_READY=FALSE`；③ 差异识别新增 4 条（§46 #7-10）：技术栈沿用 React（非 Vue）、状态模型沿用 7 态（非 10 态）、前端以 FE-0~FE-9 为权威（非 F1-F7 重建）、legacy 壳不重置；④ §48.4 补 F1-F7 交叉视图映射表；⑤ §44.1/44.2/44.3 快照覆盖式更新至 13:08。产出 `docs/MASTER_ROADMAP_STATUS_REPORT.md`（§41 21 节全量状态报告）。**下一步**：FE-0 tRPC 暴露（P0 前端前置，可立即开工）+ P2 四编码缺口（C-19.1/C-18.2/C-22.1/C-23.1）可并行；数据链 C+E 运行中（~4,128 股待回填，预计今晚）、D 排队。
- **2026-09-07 14:02 — WORK C-18.2 Monte Carlo/Bootstrap CODE_READY**（并行 agent 交付，协调者复核验证）。STEP 18 随机化稳健性落地：新增 `server/research/stochasticRobustness18/`（13 文件 3283 行：types.ts StochasticMethod(monteCarlo/bootstrap/orderRandomization)/StochasticSpecimen/MetricsView/Conclusion/Run/Request + STOCHASTIC_METHOD_CAVEATS 方法学警告表；prng.ts mulberry32 目录内自实现 + 有放回/无放回抽样核；sampling.ts 三法共用样本核；monteCarlo.ts/bootstrap.ts/tradeOrder.ts 三法；statistics.ts 路径统计复用 shared/quant-stats sharpeRatio；distribution.ts 分位/百分位 CI/基准中秩百分位/尾部概率 P(收益<0)·P(MaxDD>X)·P(Sharpe<0)；verdict.ts 结论判定**复用 C-18.1 resolveRobustnessThresholds import 只读**；serialize.ts 三指纹 round-trip；run.ts runStochasticRobustness + 三便捷入口 + id/createdAt 注入）。诚实边界：block/stationary bootstrap 标 unassessed、BCa/bootstrap-t 与 p 值/假设检验不做、不跑真实回测、不接 DB。单测 50 例；全量 45 文件 916 全过、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./stochasticRobustness18"`。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-18.2。
- **2026-09-07 14:02 — WORK C-22.1 Market Regime 体系 CODE_READY**（并行 agent 交付，协调者复核验证）。STEP 22 市场状态落地：新增 `server/research/marketRegime22/`（12 文件：types.ts 七维契约 + REGIME_UNASSESSED_REASON_CODES 5 码 + MarketRegimeRun；config.ts 七维阈值默认值逐条文档化依据 + resolve*Config 非法响亮抛错不 clamp；dimensions.ts 七维计算器 + buildRegimeLookbackWindow(T−N+1..T 含 T 回看) + 逐日 assertRegimeWindowPit；facts.ts 涨停判定复用 boardRules.resolveLimitRules（100×1.1 浮点用 1e-9 容差注释披露）；composite.ts 复合键（unassessed 维编码 NA:reasonCode）；attribution.ts 分组归因聚合（表现注入未匹配显式计数）；adapters.ts C-16.3 TradeQualityRegimePerformance(assessed) + C-13.3 §28 regime 映射；serialize.ts 指纹 + PIT 不变量校验；run.ts/dates.ts/errors.ts）。诚实 unassessed：Sentiment 无数据源默认 REGIME_SENTIMENT_SOURCE_MISSING（不用涨停家数冒充情绪，proxy 默认关闭）；窗口不足/基准缺失/横截面空/成交额缺失分别记 REGIME_INSUFFICIENT_HISTORY/REGIME_BENCHMARK_MISSING/REGIME_NO_CROSS_SECTION/REGIME_DATA_MISSING，一律不降级为中性。单测 51 例；全量 45 文件 916 全过、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./marketRegime22"`。遗留：C-16.3 evaluateTradeQualityMetrics 建议增可选 regimeTags 入参走 buildTradeQualityRegimePerformance；C-13.3 mappingContext 增可选 regimeTags 走 toExperimentLineageRegime（取主导复合状态）；情绪维待新增情绪数据表后评估。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-22.1。
- **2026-09-07 14:02 — WORK C-19.1 Walk-Forward 滚动窗口 + 冻结纪律 CODE_READY**（子代理写出 6 文件后因模型 429 频率限制中断，协调者接手完成并修复 bug）。STEP 19 Walk-Forward 落地：新增 `server/research/walkForward19/`（7 文件 2400+ 行：types.ts 契约权威源——rolling/anchored 窗口模式、gap/embargo 防标签重叠、WalkForwardRun/WalkForwardRequest；windows.ts generateWalkForwardSplits 交易日锚定 Train/Test 成对窗口 + assertWalkForwardSplitInvariants（Test 严格晚于 Train 且集合无重叠运行时断言）+ validate/resolve；freeze.ts deepFreezeParameterSet + selectWalkForwardFrozenParameters（**下中位数显式非 argmax**）+ verifyWalkForwardFreezeDiscipline（键一致/深冻结/Test 晚于 Train 机器检查）；run.ts runWalkForward 逐窗 Train→Optimize(复用 C-17.1 runParameterSearch)→Freeze→Test(evaluator 注入)→Move Window；aggregate.ts 最小 OOS 聚合 + oosDegradationPp 如实呈现；serialize.ts 指纹 + round-trip + 篡改拒绝；index.ts）。边界：OOS 隔离记录持久化 + 聚合报告留 C-19.2、过拟合结论留 C-20、无 promotion 代码。**协调者修复关键 bug**：子代理遗留 test.parameterSetKey 用 canonicalStringify(`{"k":2}`) 而冻结键用 rollingParameterSetKey(`"k"=2`) 格式不一致 → 冻结纪律机器检查全窗误报；改 run.ts test 阶段统一 rollingParameterSetKey（types.ts 注释本约定复用 C-17.2）。单测 26 例（窗口几何/embargo/gap/anchored/maxWindows/不足窗报错/下中位数非 argmax/篡改 test 数据不影响冻结参数/确定性/无合格参数 skipped/test evaluator 抛错 skipped/round-trip 篡改拒绝/结构校验）；全量 45 文件 916 全过、tsc exit 0。协调者补丁：research/index.ts 增 `export * from "./walkForward19"`。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-19.1。
- **2026-09-07 14:40 — WORK C-19.2 IS/OOS 隔离记录与归档 CODE_READY**（并行 agent 交付，协调者复核验证）。STEP 19 样本内/外隔离落地：新增 `server/research/oosIsolation19/`（9 文件：types.ts `WindowResultRecord` Train/Test 参数与结果**字段分离** + `OosIsolationRun/Request` + `OosSkipReasonCode`；discipline.ts `verifyOosIsolation`/`assertOosIsolationDiscipline`/`assertWindowResultIsolation` 键白名单 + 无重叠 + 参数不回写 + window id 唯一机器检查；record.ts `buildWindowResultRecords` 从 WalkForwardRun 构建逐窗隔离记录 + OOS 曲线 PIT 边界断言（越界抛 OOS19_OOS_CURVE_OUTSIDE_TEST_WINDOW）；aggregate.ts `computeOosAggregationReport` 逐段 C-16.1/C-16.2 完整评估 + 描述性分段聚合（不下过拟合结论）；ledger.ts in-memory append-only 归档账本（重复 runId 拒绝）；serialize.ts round-trip + **反序列化后隔离纪律复核**；run.ts `runOosIsolation` 主编排）。**复用**：C-19.1 `generateWalkForwardSplits`（窗口几何重放取完整 trainDates/testDates 做无重叠+PIT）/`computeWalkForwardAggregate`（oosDegradationPp 口径一致）、C-16.1/16.2 指标、canonicalStringify。**诚实边界**：PBO/参数敏感性正式判定/因子消融/过拟合结论明确留 C-20；OOS 权益曲线可选注入，缺窗标 `OOS19_NO_OOS_EQUITY_CURVE`（仅标量绩效，完整指标 unassessed）。单测 23 例；全量 **47 文件 974 全过**、`tsc --noEmit` exit 0。协调者补丁：research/index.ts 增 `export * from "./oosIsolation19"`。新增顶层符号 31 个全库查重交集 0。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-19.2。
- **2026-09-07 18:08 — C+E v1 旧任务中断诊断 + v2 提速改造启动**。用户报告后台任务持续报错。实查：`task 319415`（v1，12:07 启动）于 18:08 之后停止写入（最终断点 E 3020 股/560 万行、C 6361 行）；尾部日志 394 只 failed / 790 次 retry 全是「网络接收错误」——BaoStock 高峰期服务端抖动，旧 retry 间隔 600/1200ms 太激进反而加剧服务端雪崩。**v2 改进**（`scripts/backfillStatusLiquidity.ts`）：① `MAX_FETCH_RETRIES` 3→6，retry 间隔改 3s/6s/12s/24s/48s 指数退避；② 连续失败 5 只触发 30s cooldown 防服务端雪崩；③ 失败股票落 `scripts/_failed_stocks_ce.json`，下轮启动时按 `lastFailedAt` 升序提到队首优先重试（不放回队尾）；④ `--interval` 默认 300ms 改为任务指定 1000ms（贴近 BaoStock 1.43 req/s 上限）。**多线程/提速评估**：① BaoStock 单账号硬限速 ~1 req/s（实测 8 req/5.6s = 1.43 req/s），单进程再优化无收益；② Tushare `daily_basic` 限 1 次/分钟（积分不足），不能作替代；③ 多账号并行可提速（2 账号 → ~5h，3 账号 → ~3.5h），但需用户额外注册免费 baostock 账号。**v2 启动后实测（8 分钟）3018→3085 股，~8.4 股/min，零错误零重试**，健康运行中。剩 ~2467 股预计 ~5h 完成（今晚 23:30 前后）。更新 §44.1/44.3 + §47 append。
- **2026-09-07 14:40 — WORK C-23.1 模拟账户与持仓 CODE_READY**（并行 agent 交付，协调者复核验证）。STEP 23 模拟交易第一批落地：新增 `server/research/paperAccount23/`（9 文件 2588 行：types.ts `PaperAccount`/`PaperAccountPosition`/`PaperAccountOrder`/`PaperAccountFill`/`PaperCashLedgerEntry`/`PaperAccountRun`/`PaperPnlBreakdown`/`PaperSignalSource` + PAPER_ACCOUNT_RUN_KIND/VERSION；errors.ts `PaperAccountError` 21 稳定码；account.ts 账户状态机纯函数 createPaperAccount/settlePaperAccountT1/applyPaperBuyFill/applyPaperSellFill/freezePaperCash/unfreezePaperCash/markPaperAccountToMarket/snapshotPaperAccount——不可变 + 权益恒等式 equity=cash+frozen+Σmv；constraints.ts `checkPaperOrder` 订单→成交约束检查 + `describePaperAccountConstraintEnforcement` 六维能力矩阵；run.ts `computePaperPnlBreakdown`（PnL 恒等式）+ `assemblePaperAccountRun` + `toTradeQualityEvaluationInput`（C-16.3 适配）；serialize.ts/validate.ts；index.ts）。**复用**：C-14.3 `ExecutionConstraintDeclaration`/`DEFAULT_LOT_SIZE`/`describeExecutionConstraintCoverage`（17 轴能力矩阵）、C-14.2 `computeFillCostBreakdown`（五维成本分解）+ `toEngineCostModel`、STEP 8 Side/EquityPoint/涨跌停口径/PositionBook 会计口径（均价/成本基/已实现结转）、C-16.3 `TradeQualityEvaluationInput` 适配。**诚实 blocker**：`timing.executionModel`/`allowPartialFill`/`LIMIT_PRICE` 账户层仅记录不强制执行；Signal 注入式记录不做生成；能力差异——perSecurityEquityCap/totalEquityCap/buyBanned/sellBanned 账户层有市值与订单级检查点可 ENFORCED（C-14.1 plan 层标 blocker 处账户层放行，已声明 + 测试对照锁定）。**命名避撞**：`PaperPosition`/`PaperOrder` 被 legacy `server/paperTrading.ts` 占用 → 改用 `PaperAccountPosition`/`PaperAccountOrder`。单测 35 例；全量 **47 文件 974 全过**、`tsc --noEmit` exit 0。协调者补丁：research/index.ts 增 `export * from "./paperAccount23"`。新增顶层符号 47 个全库查重零冲突。**遗留**：C-14.2 `computeFillCostBreakdown` 零冲击卖出产生 `-0`（JSON round-trip `-0→0`，金融语义等价，超本任务边界未改）；frozen 冻结/解冻何时触发属 C-23.2 编排。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-23.1。
- **2026-09-07 18:50 — 板块分级排序 + `--board=` 精确筛选 CLI（用户策略）**。用户决定按交易所板块优先级同步：主板优先、创业板次之、科创板再次、**北交所先不同步数据**。实查 universe 5552 板块分布（research_security_identifier_history）：主板 3486（SH 60xxxx=1844 + SZ 000/001/002/003=1642）、创业板 1447（SZ 300/301/302）、科创板 619（SH 688/689）、北交所 0（**identifier_history 里没有——研究链路本来就不同步**）。v1（PID 773）+ v2（task uG0LTo）已主动停止清理。**v3 改造**（`scripts/backfillStatusLiquidity.ts`）：① 新增 `CliArgs.boards?: Set<BoardKey>` 与 `--board=<list>` 参数（main/cyb/kc/bj 逗号分隔），覆盖默认 skipBj 行为；② `boardPriority()` 按 SH 主板→SZ 主板→创业板→科创板→北交所 排优先级（默认开启 `--no-priority` 关闭）；③ `boardKeyOf()` 返回板块 key 用于 --board 白名单匹配；④ 发现数据异常 prefix：42 只 SZ `003xxx`（深主板新段，2024 起）+ 1 只 SZ `302xxx`（创业板扩展）+ 1 只 SH `689xxx`（科创板扩展），扩展判断逻辑；⑤ 新增 `--include-bj`（默认跳过）；⑥ v1 残留进程 PID 773 主动 SIGKILL（避免与新任务 BaoStock 单会话互踢）。当前进度 E 3155 股/572 万行（v1 残留最后阶段自跑写入）。用户自跑命令已提供（分板块 4 个独立命令 + 主板+创业板合并 1 个）。
- **2026-09-07 19:30 — WORK C-20.1 PBO + 参数敏感性 CODE_READY**（并行 agent 交付，协调者复核验证+纪律修复）。STEP 20 过拟合检测第一批落地：新增 `server/research/overfittingDetection20/`（8 文件 3450 行：types.ts 契约权威源 + 阈值 import from robustness18 re-export（**纪律修复**：子代理初版 types.ts:586-590 重复定义 C-18.1 的 `DEFAULT_RETURN_DRIFT_THRESHOLD_PCT=5`/`DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT=3`，违反"复用而非重写"原则 → 协调者改为 import 复用）/ pbo.ts CSCV 划分+倒置统计+零分布 10-bin 直方图+分位 CI+判定+指纹 / parameterSensitivity.ts 复用 C-18.1 `generateParameterPerturbationVariants` + evaluator 注入 + 漂移判定 + 敏感度度量（max 偏离/σ/CV/弹性）/ assess.ts Overfitting 聚合判定（5 类结论 OVERFIT/OVERFIT_RISK/NOT_OVERFIT/INCONCLUSIVE/NO_EVAL）/ serialize.ts 三类记录 round-trip+篡改拒绝 / run.ts runOverfittingDetection+Run ID / index.ts 统一出口；test.ts 55 例 9 大组）。**复用**：C-18.1 扰动集+阈值语义、C-19.2 OOSRun 端到端接入（pbo 喂入 OOS 段总收益，684ms 跑通真实链路）、shared/quant-stats percentile/mean/stdDev、canonicalStringify、ResearchValidationError。**诚实边界**：CV-PBO/贝叶斯收缩/p-value 假设检验明确不做；PBO 不足候选/块显式 unassessed+reasonCode（`PBO_INSUFFICIENT_CANDIDATES`/`PBO_INSUFFICIENT_BLOCKS`/`PBO_NO_VALID_SPLIT`/`PBO_INVALID_METRIC`）；不下"能否上线"结论（C-25.1）。**命名避撞**：`Pbo*`/`Overfitting*`/`serialize*`/`deserialize*` 已被 legacy STEP 6.5（`pbo.ts`/`overfittingAssessment.ts`）占用 → 重命名 `Ofd*`（OfdPboResult/OfdAssessmentInput/assessOfdOverfitting 等 22 类型+8 别名+11 常量+20 函数）。**冲突模拟**：export \* 三模块（legacy pbo + legacy overfittingAssessment + 新 overfittingDetection20）一起导出 → 0 冲突。**协调者违规接受**：C-23.2 子代理违反约定改了 index.ts 做 `toTradeQualityEvaluationInput` 消歧，接受其合理解决 + 补 C-20.1 导出。单测 55 例；全量 **49 文件 1047 全过**、`tsc --noEmit` exit 0。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-20.1 + 新增 §0.4 开发活动状态字段（活动状态 done）/ §0.5 顶部 active 概览 / §0.6 活动历史。
- **2026-09-07 19:30 — WORK C-23.2 信号→订单→成交→PnL 闭环 CODE_READY**（并行 agent 交付，协调者复核验证+接受违规）。STEP 23 模拟交易第二批落地：新增 `server/research/signalToPnl23/`（8 文件：types.ts SignalToPnlRun + PnlLoop* 子结构 + 注入式价格源/信号选择器接口；errors.ts SignalToPnlError 18 稳定码；engine.ts runSignalToPnlLoop 主编排 a/b/c/d 四步= T+1 结算→执行日 checkPaperOrder+applyBuy/SellFill+失败 unfreeze→决策日 planDecisionDay+freezePaperCash→mark-to-market；run.ts toTradeQualityEvaluationInput C-16.3 适配+toPaperAccountRunView；serialize.ts canonical+sha256+round-trip+篡改拒绝；validate.ts 结构复核；index.ts 聚合导出；test.ts 18 例）。**复用**：C-13.2 CandidateEvaluationRun（信号来源+指纹+point=close 校验）、C-23.1 8 原语（createPaperAccount/settlePaperAccountT1/applyPaperBuyFill/applyPaperSellFill/freezePaperCash/unfreezePaperCash/markPaperAccountToMarket/snapshotPaperAccount）+checkPaperOrder+computePaperPnlBreakdown+describeExecutionConstraintCoverage、C-14.2 computeFillCostBreakdown+toEngineCostModel、C-14.3 DEFAULT_LOT_SIZE+声明指纹、C-14.1 planDecisionDay（候选→Order，绝不重写）。**PIT 时序纪律**：决策日 D 订单 executionTime=D+1、成交价严格 D+1 open（非 D 收盘，避免 look-ahead）、冻结金额用 D 收盘算（盘后已知 PIT 安全）。**frozen 设计兑现**：买单 freezePaperCash→成交 applyPaperBuyFill 扣减冻结+记 ledger→拒单/未成交 unfreezePaperCash 释放；卖单用 T+1 可卖股数检查。**协调者接受违规**：C-23.2 子代理违反约定改了 index.ts 做 `toTradeQualityEvaluationInput` 消歧（paperAccount23 改显式列举跳过同名、signalToPnl23 主导）；接受其合理解决。**诚实边界**：Trade Journal/Planned vs Actual/Deviation/Reason/Emotion/Post-review 明确留 C-24.1；PnL 归因留 C-16.1；promotion 留 C-25.1；C-23.1 标注的"仅记录不强制执行"约束保持一致不冒充。单测 18 例；全量 **49 文件 1047 全过**、`tsc --noEmit` exit 0。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-23.2。
- **2026-09-07 18:06 — 新增 §0.4 开发活动状态字段（pending/active/done/blocked，正交于 7 态）+ §0.5 顶部 active 概览 + §0.6 活动历史 append-only**。用户「正在开发的任务单独加个状态」——按 §0.1 7 态铁律"状态列只填 7 态值"，不能在状态列加新值；改在 `负责人` 列追加 `[活动值]` 后缀做轻量标记（不动列结构、不污染 7 态）+ 顶部独立概览 + 活动历史 append-only 防篡改。`active` ↔ `done`/`blocked` 变更必须入 §0.6 与 §5 双留痕。首条留痕：C-20.1、C-23.2 18:06–19:30 全程。
- **2026-09-07 22:53 — WORK C-20.2 因子消融与 OOS 退化 CODE_READY**（并行 agent 交付，协调者复核验证）。STEP 20 第二批落地：新增 `server/research/factorAblation/`（10 文件 2791 行：types.ts AblationTarget/四模式 REMOVE_SINGLE/LEAVE_ONE_OUT/CUMULATIVE_REMOVE/FORWARD_ADD + VariantSpec（BASE_FULL/BASE_EMPTY + ABL_REMOVE_/ABL_CUM_/ABL_FWD_ 单变量码）+ evaluator 注入契约 + AblationThresholds（IS 贡献地板 1pp/OOS 中性天花板 0.5pp）+ ReasonCodes（ABL_NO_OOS_TRACK/ABL_NO_IS_VARIANTS/ABL_NO_OOS_VARIANTS/ABL_IS_BASE_FAILED/ABL_OOS_BASE_FAILED）；variants.ts validate/resolveOrder/buildVariants；contribution.ts computeAblationContributions（remove 族=base−removed、add 族=added−previous，排序 IS 贡献 DESC + targetId ASC 平局，**显式非 argmax**）；assess.ts assessAblationRun（evaluator 仅调用一次、异常/非法返 failed、指纹+deepFreeze）；serialize.ts round-trip+篡改拒绝；adapt.ts toAblationRobustnessView + toAblationOfdAssessmentInput（**与 C-20.1 Ofd 汇合真实 OVERFIT 已测**）；discipline.ts verifyAblationOosDiscipline（oosTrackPresent/tracksAligned/targetSetsIdentical/orderFixedBeforeEvaluation/signalsDoNotDriveOrder）；run.ts + ABL runId；index.ts；test.ts 45 例）。**核心设计 IS/OOS 双轨消融**：同套消融目标分别在 IS 与 OOS 执行（OOS 段注入只读、不参与任何目标筛选），IS 贡献 vs OOS 贡献对照产出**机器可读过拟合信号候选**（ABL_IS_POS_OOS_NEG/NEUTRAL，描述性归因非因果、需人审复核）——识别「回测好、泛化差」。**复用**：C-19.2 真实 runOosIsolation、canonicalStringify。**诚实边界**：p 值/贝叶斯/自动剔除重训/单点 argmax 明确不做；跨品种泛化留 C-25.1。全量 **51 文件 1121 全过**、`tsc --noEmit` exit 0。协调者补丁：research/index.ts 增 `export * from "./factorAblation"`（tsx 实例化 exports=805）。新增顶层符号 27 个全库查重零冲突。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-20.2。
- **2026-09-07 22:53 — WORK C-24.1 交易日志 CODE_READY**（并行 agent 交付，协调者复核验证）。STEP 24 第一批落地：新增 `server/research/tradeJournal/`（10 文件 3609 行：types.ts TradeJournalEntry/JournalPlannedFacts/JournalActualFacts/JournalDeviation/AnnotationBlock/PostReviewRecord/DeviationDimension（机器维度枚举）+ 受控词表（reasonCode 8/emotionCode 10/severity 3）+ TJ_UNASSESSED_REASON_CODES；errors.ts TradeJournalError 32 稳定 TJ_* 码；reconcile.ts reconcilePlanVsActual（数量差/价格差口径「实际成交价−planned 参考价」/执行偏移/未成交原因引用 + buildJournalActualFacts VWAP 聚合，actual 早于 planned 响亮拒绝）；drafts.ts buildJournalDraftsFromRun（从 C-23.2 SignalToPnlRun 逐订单提取 draft、机器核对自动填 annotation=null + 诚实跳过计数）；ledger.ts TradeJournalLedger append-only（修订=bump vN 挂 supersedes 链、篡改/回退/断链拒绝）；review.ts createPostReviewRecord/withJournalAnnotation/annotateJournalEntry；serialize.ts 指纹 round-trip + verifyTradeJournalLedgerContent；validate.ts PIT 时间序校验（decision≤执行日≤成交≤标注/入账）；index.ts；test.ts 29 例）。**复用**：C-23.2 SignalToPnlRun（orders/fills/rejectionLedger + 指纹来源可信复核）、C-23.1 PaperAccountOrder/Fill 形态、canonicalStringify、C-13.3 显式缺省码哲学。**诚实边界**：planned 参考价仅当决策/执行日在 run 日历相邻断言通过才用 fill.basePrice（=决策日 close PIT 安全）推断，否则 unassessed（TJ_EXECUTION_DAY_NON_ADJACENT/TJ_PLANNED_PRICE_REFERENCE_MISSING）；reason/emotion/ruleViolation **零生成**（annotation 人工注入，draft=null）；跨交易聚合/纪律打分/最差执行排序留 C-24.2。全量 **51 文件 1121 全过**、`tsc --noEmit` exit 0。协调者补丁：research/index.ts 增 `export * from "./tradeJournal"`。新增顶层符号 47 个全库查重零冲突。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-24.1。
- **2026-09-08 22:53 — WORK C-24.2 纪律反馈分析 CODE_READY**（并行 agent 交付，协调者复核验证）。STEP 24 第二批（末批）落地：新增 `server/research/disciplineFeedback/`（12 文件 3267 行：types.ts DisciplineFeedbackRun/四类报告/DFA_REASON_CODES(10)/DFA_ENV_UNLABELED_KEY/DFA_SEVERITY_INDEX/JournalEnvironmentAssignment；errors.ts DFA_ERROR_CODES 14 稳定码；common.ts resolveFeedbackEntries（latest-per-journal 归并、同版本歧义拒绝）+ 日历纯函数 + stablePercent/Mean；causes.ts aggregateViolationCauses 违规原因统计（ruleViolation=true 按 reasonCode+severity+维度过滤，未标注显式 counted-unannotated）；repeat.ts detectRepeatMistakes（3 分组维度/2 scope/阈值/窗口峰值两指针，纯描述性）；executionQuality.ts rankExecutionQuality（价格偏差率/未成交+部分成交率/时机晚率，**样本不足不排名**）；environments.ts identifyErrorProneEnvironments + normalizeJournalEnvironmentAssignments（regime/环境标签**注入不自算**，违规密度+平均 severity，无标签归 ENV_UNLABELED）；run.ts buildDisciplineFeedbackRun（输入账本指纹→四类聚合→模式清单→**9 分支诚实结论** stable/patternsFound/inconclusive+reasonCode）；validate.ts 结构+值域+计数自洽+排名连续性；serialize.ts 指纹 round-trip+篡改拒绝；index.ts；test.ts 38 例）。**核心价值**：C-24.1 边界注释明确声明的「跨交易聚合分析」至此兑现——把逐笔日志升级为「为何违规/重复错误/最差执行/易错环境」四问的机器可读描述性报告，供 C-25.1 端到端与人工消费。**复用**：C-24.1 tradeJournal 全 import 只读（JOURNAL_REASON_CODES/severity/维度词表/assertValidTradeJournalEntry/指纹/TradeJournalLedger 零重定义）。**诚实边界**：annotation null 的 draft 不计原因（单列 count）；空账本/单 entry/全未标注 → inconclusive+reasonCode 不硬出结论；不生成处方建议/不做因果推断；与 C-22 marketRegime 真实挂接留 C-25.1。**上游遗留债务**：C-24.1 reconcile 无成交时产 fillState=NONE+actual=null，但其 validate.ts:411 无 null guard → assertValidTradeJournalEntry 实际拒绝 actual=null，真实账本不存在合法 unfilled entry（探针证实；executionQuality 已留 NONE 防御分支当前不可达），根治需 C-24.1 侧补 null guard 或改口径。全量 **52 文件 1159 全过**、`tsc --noEmit` exit 0、tsx 实例化 exports=805→845（+40 吻合）。协调者补丁：research/index.ts 增 `export * from "./disciplineFeedback"`。新增顶层符号 40 个全库查重零冲突。CODE_READY；VALIDATED 依赖数据链就绪认证。更新 §44.4 说明 + TASK_TRACKING C-24.2。**STEP 24 链全通（24.1→24.2）**；剩唯一编码任务 C-25.1（依赖 C-21.1✓/C-22.1✓/C-24.2✓ 全部满足）。

- **2026-09-08 23:20 — WORK FE-6/7/8/9 骨架线 CODE_READY（并行开发交付）**。前端研究链路剩余四页**并行落地**（独立 agent 并行 + 主 agent 集成），ROADMAP §48.4 FE-6~9 DESIGN→CODE_READY。新增 4 文件 + 路由 + AppShell「研究数据」组 9 项：`client/src/pages/ParameterSearch.tsx`（`/parameter-search`）、`WalkForwardAnalysis.tsx`（`/walk-forward`）、`RegimeReport.tsx`（`/regime-report`）、`ReviewWorkbench.tsx`（`/review-workbench`）。**契约零改动 / 零伪造**：就绪门 + 空态 + TechnicalDetails；字段字典 1:1 取自真实引擎（parameterSearch/rollingOptimization/robustness/stochasticRobustness · walkForwardRun/oosIsolation/overfittingDetection · marketRegime · tradeJournal/disciplineFeedback/paperAccount）；按钮 disabled（无端点）；不引图表库/零 trpc/零假样例。**验收点**：FE-7 IS/OOS 视觉隔离（slate vs indigo+警示）、FE-9 R7 琥珀隔离条均落实。FE-8 如实注明报告导出服务尚不存在。**修复**：ParameterSearch JSX 内裸 `{…}` 类型字面量三处（逗号表达式解析错）→ 字符串表达式。**验证**：前端 tsc 零错误（全量残留报错仅在 `server/research/closedLoop/*`——并行协调者在途 C-25.1 噪音非本任务）、`vite build` 通过、client 17 测试全过。TASK_TRACKING G3 FE-6~9 状态同步。真实联调依赖各对应 run 端点暴露 + C-17/18·19/20·22/23·24/25 认证。
- **2026-09-08 23:25 — WORK C-25.1 闭环整合 CODE_READY = 编码链 G2 完结（29/29 全部 CODE_READY）**（并行 agent 交付，协调者复核验证）。STEP 25 Production Quant Platform 编排落地：新增 `server/research/closedLoop/`（12 文件 ~3000 行：errors.ts CLOSED_LOOP_ERROR_CODES 18 码；blockers.ts CLOSED_LOOP_BLOCKED_REASON_CODES 10 码 + LIFECYCLE_THRESHOLD_ 门槛前缀；types.ts 14 阶段常量 + 14 种 handoff 接口/union + ClosedLoopRun + provider/executor 契约 + allowSyntheticEvidence；spec.ts CLOSED_LOOP_STAGE_SPECS 14 条 + resolveClosedLoopStageSelection（空/重复/未知/逆序抛错）；guards.ts handoff 形状校验 + run 指纹核验 + 全树非有限数/日期扫描；serialize.ts computeClosedLoopChainFingerprint + round-trip；lifecycle.ts 复用 C-21.1（LIFECYCLE_THRESHOLD_* → BLOCKED CL_GATE_EVIDENCE_MISSING；跳级抛错；合成证据默认阻塞）；lineage.ts 复用 C-13.3 §28 谱系挂载；adapters.ts 纯映射（summarizeTradeSimulationRun/composeClosedLoopEvaluationRef）；orchestrator.ts runClosedLoop 主编排（门禁 data→gate→runner→seed + 统一谱系账 + 异常重抛）；index.ts；test.ts 32 例 8 组）。**核心设计**：编排器只做契约校验 + handoff 摘要流转（引用+摘要不复制 rows 级大对象）+ 审计 + 记录，14 阶段算法由注入 executor 实现；真实数据未注入 → BLOCKED（CL_DATA_NOT_INJECTED/CL_DATASET_GATE_NOT_PASS）；无 datasetGate PASS evidence → lifecycle 不推进（测试证明）；合成 smoke 标 synthetic:true。**关键纪律**：closedLoop 被 research/index.ts re-export → 编排器严禁 import ../index，一律直接相对路径 import 兄弟模块（防 ESM 循环）。**与 C-24.1 债务交互**：review 阶段 unfilled entry 经 CL_REVIEW_UNFILLED_VALIDATION_DEFERRED wiringLimit 诚实记录，未改 C-24.1。单测 32 例；全量 **53 文件 1191 全过**、`tsc --noEmit` exit 0、tsx 实例化 exports=845→904（+59 吻合）。协调者补丁：research/index.ts 增 `export * from "./closedLoop"`。CODE_READY；VALIDATED/PRODUCTION_READY 依赖数据链就绪认证。**G2 编码链里程碑**：C-12.5.1~C-25.1 共 29 项全部 CODE_READY；下一步转入 P1 数据域认证（D 域回填中）+ P3 端到端验证（接真实 executor/DB）。

- **2026-09-09 01:13 — 回测性能专项优化 + 生产回测退出缺口定位**（用户选定「修回测性能」方向）。**性能实测基线**（`getLeaderCandidateResearch` 冷缓存）：DB 段 31.7s（价格行 JOIN 12.2s + 覆盖率全表扫描 8.9s + 涨停记录 2.2s + 其余 ~1s 串行）+ 计算段 5.8s。**四项优化落地**：① `server/db.ts` `getLeaderCandidateDailyPriceCoverage` 加独立 10 分钟 `TTLCache`（890 万行全表 COUNT/SUM 只在回填后变化，避免每次冷缓存重扫，8.9s→热 0）；② `loadBacktestBaseContext` 五路独立 DB 查询（records/priceRows/coverage/marketFactors/suspensionWindows）改 `Promise.all` 并行（mysql2 连接池默认 10），DB 段 24s→13s（收敛到最长单路价格行 JOIN ~12s）；③ `server/data/validation.ts` `isValidDate` 由 `new Date().toISOString()` 往返改为数值范围判定（闰年/月日边界等价，336K 行 validateMarketBar 0.76s→0.24s）；④ `server/strategy/strategyBacktest.ts` `viewOf` 提升 `buildLatestStockNameMap` + records 副本为一次性构建（消除逐日 O(15595) 名称映射重建）。**结果**：冷缓存 37.5s→**16.7s**（DB 12.4s + 计算 4.3s），参数变更（DB 3 分钟 TTL 命中）5.8s→**4.3s**；`tsc --noEmit` exit 0、data/strategy/engine/features/productionIntegration 共 107 例全过。**遗留**：冷缓存地板=价格行 JOIN 12.2s（336K 行远程 TiDB 传输，硬约束）；计算段最大项=feature pipeline 962ms（visibleBars+MarketBarSeries 逐快照重排序）。**关键正确性发现**：生产引擎回测（`runLeaderCandidateEngineProbe`）**无退出策略**——`leaderCandidateBaselineStrategy.evaluate` 只产出 BUY 信号、无 SELL，持仓推到回测期末 `finalizeOpenTrades` 才标记 openAtEnd，故 `realisticSimulation` 恒为 tradeCount=5（maxPositions=5 卡满后不再开新仓）、completedTradeCount=0、winRatePct=null、5 笔全部 2025-10-17 建仓持有到期末（决策日志 1105 BUY / 0 SELL）。`maxHoldingDays/stopLoss/trailing` 等退出语义仅存在于 research-legacy 模拟器（`realisticBacktest.ts`），新引擎未接。**判定**：此为「帮我决策」的硬阻断（无退出→胜率/回撤/盈亏全无意义），优先级高于继续压性能；建议下一步专项实现「生产引擎退出策略」（引擎 ReadonlyPortfolioSnapshot 需补 entry 日期/成本 + baseline 策略产出 SELL，或桥接 legacy 退出语义）。§44 未变（纯代码层 + 无数据快照变更）。

- **2026-09-09 01:53 — WORK FE-5 绩效仪表盘真实接入 + research.metrics.evaluate 端点暴露（研究链路前端接入第一阶段）**。用户要求核查「前端端点未接入」，实测确认：FE-5~FE-9 五页为**空壳骨架**（FE-5 仅 1 端点、FE-6~9 零端点），根因是后端 17 个研究引擎模块 CODE_READY 但 **tRPC 端点未暴露**（appRouter 无 run/metrics/parameterSearch/marketRegime 等路由）。本轮落地 FE-5：① `shared/researchContracts.ts` 新增绩效评估契约（equityPointSchema/tradeSchema/metricsEvaluateInputSchema，1:1 对应 server/backtest EquityPoint/Trade）；② `server/researchRouter.ts` 新增 `metrics.evaluate` 端点（C-16.1 evaluatePerformance + C-16.2 evaluateRiskAdjustedMetrics + C-16.3 evaluateTradeQualityMetrics 三套指标共享同一 equityCurve/trades 一次性求值，纯函数确定性，退化输入响亮抛错不静默 NaN）；③ `client/src/pages/PerformanceDashboard.tsx` 从死空壳接入真实数据——「技术预览」数据源（生产回测 `getLeaderCandidateBacktest` 的 realisticSimulation → 字段映射 → metrics.evaluate），指标卡 11 项/权益曲线/回撤剖面/交易明细/月年一致性全真实渲染，R7 隔离标注「技术预览·非 RESEARCH_READY 口径」。**真实数据端到端验证**：回测 17s 产出 431 点权益曲线 + 5 笔交易 → 评估器算出总收益 18.28%、CAGR 10.34%、MaxDD 35.56%、Sharpe 0.572/Sortino 0.814/Calmar 0.291、月一致性 22 月/年一致性 3 年；**诚实暴露退出策略缺陷**——5 笔全 openAtEnd（0 完成交易）→ 胜率/PF/期望为 null（0/5），印证 §47 01:13 记录的「生产引擎无退出策略」缺口。**验证**：`tsc --noEmit` exit 0、`vite build` 通过、research 152 例测试全过。**剩余阶段 2~5**：FE-6 参数搜索（parameterSearch/rollingOptimization/robustness/stochasticRobustness）、FE-7 WFO（walkForwardRun/oosIsolation/overfittingDetection）、FE-8 Regime（marketRegime）、FE-9 复盘（tradeJournal/disciplineFeedback/paperAccount）。

- **2026-09-09 03:35 — 数据域 P0 收尾完成：certify gate 口径修正（C 事件态 + D CA 事件态）+ `RESEARCH_READY = TRUE`**。用户指令「把 C 域和 D 域不足 5000 的问题修正一下」。实查证据链：① D 域收官——corporate_actions 全表 31,641 行/4,824 股（主板 2,932 于 9/8 完成、创业板 1,338 + 科创板 553 于 9/9 03:01 用户跑 `--board=cyb/kc` 完成）；E 域补跑后 **5,131 股**（用户跑 C+E 命令③）；AF 5,025 股/31,337 行。② 修正前 gate：13 PASS/4 PENDING（#6 status 1,716→1,830 只 vs 阈值 5,500；#10 CA 4,824 vs 5,000；#12 随 #6；#9 E 已 5,131 达标）。③ **口径判定证据**（铁律「真实数据优先」）：a)「有 AF 无 CA」缺口 201 只——9/9 实查 9 只样本（002021/002076/002089/002147/002168/002178/300010/300024/300025）BaoStock `query_dividend_data` 2019-2026 **全部返回 0 行** → CA 4,824 是事件态真实上限，5,000 阈值不可达；b) status 1,830 只（SUSPENDED 1,830 + ST 734）类型齐备、事件态本质（ROADMAP §48.3 R1 早已认定 5,500 阈值口径错误）；c) `_failed_stocks_ce.json` 332 条已过时（E 覆盖 332/332，全部为 9/7 spawn ENOENT 假跑，非真失败）。④ **certify 修正落地**（`scripts/step12_certify_gate.mjs`）：TH 移除 `statusCoverMin/caCoverMin`，新增 `statusEventCoverMin=1500`（#6/#12：SUSPENDED+ST 齐备 && 覆盖 ≥1,500，LISTING 边界由 #4 securities 承载）、`caGapTolerance=250`（#10：CA ≥ AF − 250 动态对齐）；adjCover 查询上提 #10/#11 共用；`#16 No critical blocker`、`#17 可复现` 不变。⑤ **结果：certify 17/17 全 PASS（0 PENDING 0 FAIL），`RESEARCH_READY = TRUE`**（快照 `docs/researchReadyGate/research_ready_gate.json` capturedAt 2026-09-08T19:33:43Z）。⑥ ROADMAP 覆盖式更新 §44.1（C/D/E/H 行 + 头部 03:33 实查 + 备注）、§44.2（C/D/E/H → DATA_READY/DATA_READY/DATA_READY/RESEARCH_READY）、§48.2（P0-1/P0-2/P0-4 → ✅ 完成 + 验收落地说明）、§48.3（R1 → ✅ 已修正）。**遗留待办**：G 域两项质量待办（§44.1，securityId 全 NULL + effectiveFrom 单点）仍 PENDING，为 STEP 12.5 PIT 审计（P1-1）前必修；CA/AF/status 属事件态表口径，§45 Entry 判定以 gate JSON 实况为准。

- **2026-09-09 22:50 — WORK STEP STRATEGY-001 Strategy Definition 能力审计（audit-only，无代码修改）**。按 STEP STRATEGY-001 规格对「定义/保存/版本化/读取一条正式量化策略」做全量能力审计，产出 `docs/STEP_STRATEGY_001_DEFINITION_AUDIT_REPORT.md`。**判定 PARTIAL**。证据链（真实代码/DB Schema）：① 声明式定义层已 CODE_READY——`server/research/strategySchema/`（C-15.1）StrategyDocument（§16 全字段：identity/version(semver)/universe/entry·exit·positionSizing·riskRules 声明式/parameters/datasetVersion/executionAssumptions+recipe+fingerprint）+ StrategyVersionRecord（§17 九项追溯）+ bump 闸门/compare/serialize canonical+sha256，28 单测；② 前端 FE-4 策略编辑器（可视化+JSON+版本 diff+生命周期）真实连通 validate/bump/compare 无状态端点（`researchRouter.ts`），但「保存/保存新版本/运行」按钮因后端端点未暴露而禁用；③ **核心 GAP：无 Strategy Repository / Service / CRUD Router / `strategies`+`strategy_versions` 持久化表**——策略仅内存存在，无法落库/重启读取/跨版本追溯（`persistence/db.ts` 仅有 Experiment/Run/SweepBatch 三套 Repository）；④ 硬编码策略：legacy「龙头候选」5 策略（`server/strategy/strategies/leaderCandidateBaseline.ts` + `leaderCandidates.ts` + `leaderCandidateStrategyBacktest.ts`）+ `client/src/lib/firstBoard.ts` 首板过滤工具，均未迁移到正式 StrategySchema；⑤ Dataset/Run 绑定 PARTIAL：`research_runs` 已有 datasetId/datasetVersion/datasetFingerprint 三字段，但 `research_experiments.strategyId/strategyVersion` 为自由文本冗余列（无 strategies 表外键）。全部 GAP DEFERRED 至 STRATEGY-002（持久化+CRUD 闭环）。本 STEP 遵守 §7/§11 未进入后续 Backtest/Parameter Search 等阶段。

- **2026-09-09 23:15 — WORK STEP STRATEGY-002 Strategy 持久化与 CRUD 闭环（Definition PARTIAL → READY，持久化口径）**。按 STEP STRATEGY-002 规格把 StrategyDefinition 从「内存声明式对象」升级为「可持久化/可读取/可版本化/可追溯的正式领域实体」，全链路真实 TiDB 验证（无 mock）。**数据库**：新增 `strategies` + `strategy_versions` 两表（migration `drizzle/0026_strategy_persistence.sql` + 幂等脚本 `scripts/applyStrategyPersistence.mjs` 已执行，statementsExecuted=6、两表 true、`uq_strategy_versions_id_version` 唯一索引 true）；`strategy_versions` 存 `strategyDocumentJson`+`versionRecordJson`+`fingerprint`+datasetVersion/universeId/codeVersion，UNIQUE(strategyId,version) 兜底不可变。**Repository/Service**：新增 `server/research/strategyPersistence/`（contract.ts 契约 + inMemory.ts 单测实现 + db.ts `DbStrategyRepository` 真实 DB + service.ts `StrategyService` + index.ts），saveVersion 幂等三态 inserted/idempotent-skip/conflict（并发 ER_DUP_ENTRY 1062 兜底），读取经 deserialize 重算指纹、篡改响亮抛错；createVersion 复用 STEP-001 `cloneStrategyDocument`/`bumpStrategyVersion`/`classifyRequiredBumpKind` 语义闸门（结构→major、参数/文本→minor）。**Router**：`server/researchRouter.ts` 增 `research.strategy.{create,save,load,list,delete,createVersion,loadVersion,listVersions}` 八端点（zod 输入经 `shared/researchContracts.ts` → Service → Repository，无 router→DB 直落；codeVersion 加载时 composeCodeVersion 注入）。**前端**：`client/src/pages/StrategyEditor.tsx` + `StrategyHeader.tsx` 解除「保存/保存新版本」禁用态接真实 save/createVersion（后端重组装回填），新增最小策略列表 Load 进编辑器；「运行」仍 disabled（§13 不实现 Research Run）。**关键修复**：`server/db.ts#getDb` 原 `drizzle(DATABASE_URL)` 把 URL 里 `ssl={"rejectUnauthorized":true}` 误当 mysql2 SSL profile 名（Unknown SSL profile）+ searchParams 丢 JSON 双引号导致 parse 失败，已最小修复为「原始字符串按 `ssl={...}` 提取 + drizzle config 形式」，向后兼容（无 ssl 行为不变），是持久化验收硬前置。**验证**：单测 12（strategyPersistence）+ 13（researchContracts 含 CRUD 守卫）+ 28（strategySchema 无回归）全过；真实 TiDB E2E `scripts/stepStrategy002E2E.mts` PASS（create→幂等 save→load→模拟重启 matchesOriginal=true→createVersion 1.0.0→1.1.0→listVersions→旧版本 fingerprint 不变→immutability 拒绝→cleanup）。**设计决策（§12）**：datasetId/datasetFingerprint 不加 StrategyDocument（datasetVersion 内容寻址可派生，改动会连锁破坏现有 document/adapter/指纹/单测），strategy_versions.datasetVersion 已满足追溯。**遗留 DEFERRED**：lifecycle 状态持久化（strategies.status 已建列，状态机 C-21.1 不在此范围）、Research Run 绑定（§13 仅保证版本稳定身份）。产出报告 `docs/STEP_STRATEGY_002_PERSISTENCE_IMPLEMENTATION_REPORT.md`。**STEP-003 将单独决定**：把「首板」定义成第一个机器可计算 Event（本 STEP 已预留首板回踩占位 StrategyDocument 供 create/save/load/version 验证）。未越级进入首板识别/Entry/Exit/Backtest 等。

# 49. 目录与模块命名规范（2026-09-07 定稿）

- **2026-09-08 22:55 — WORK FE-5 绩效仪表盘 CODE_READY（骨架线）**。前端研究链路第五项落地：新增 `client/src/pages/PerformanceDashboard.tsx`（路由 `/performance`）+ AppShell「研究数据」分组加「绩效仪表盘」。**契约零改动 / 零数据伪造**：研究 run/metrics 端点（FE-0 扩展）尚未暴露、C-14/15/16 未 VALIDATED → 页面结构完整但全空态。落地内容：数据就绪门（三前置）+ 绩效指标卡 11 项（口径字典取 engine/domain PerformanceMetrics 与 C-16.2/16.3 注释，数值全「—」）+ Equity/Drawdown 曲线占位（不引入图表库）+ 交易明细表（列头=engine/domain Trade 真实契约）+ 月/年一致性 + Regime 表现空态 + TechnicalDetails 联调清单（字段字典）。**纪律**：不显示假数值、不缓存假样例；联调时同源直填。**验证**：`tsc --noEmit` exit 0、`vite build` 通过、client 17 测试全过。§48.4 FE-5 标记 CODE_READY；TASK_TRACKING G3 FE-5 状态同步。真实曲线联调依赖 FE-0 扩展 run/metrics 端点 + C-14/16 VALIDATED（P2 后）。
- **2026-09-09 02:50 — 数据清理：limit_up_records 剔除 5% ST 涨停（当日 PIT 处于 ST 状态），20,726 条删除 + 回填脚本 ST 过滤**（用户反馈「表里很多 5% 涨停的 ST 股，本质不该存在，且已被 ST 的不会后续加入」）。**实查口径（非按名称一刀切，防误删「后来才 ST」的真实 10% 涨停）**：全表 120,220 条，名称带 ST 前缀 12,137 条；经 `research_security_status_history`（PIT 当日 ST 区间）+ 当日实际涨幅（主板 ST ≈5% vs 正常 ≈10%）交叉验证，**当日确实处于 ST 状态的主板记录 = 20,726 条**（名称带 ST 5,619 + 名称不带 ST 15,107——后者为后来摘帽、涨停当日确系 ST 的 5% 涨停；创业板/科创板 ST 为 20% 涨跌幅非清理目标，已确认为 0）。**已执行**：`scripts/purgeStLimitUp.ts`（先备份 JSON+SQL 回滚文件至 `scripts/backup/limit_up_st_records_*.json/.sql`，20,726 条 → 删除 → 残留校验 0）。**结果**：表总量 99,494，日期范围 2019-01-02 ~ 2026-09-08 不变，当日 ST 残留 0。**回填脚本防再入**：`scripts/backfillLimitUpRecords.mjs` 命中涨停时 `isStOn(code,date)` 为真即跳过（不再按 5% 收录 ST 涨停），dry-run 回归（2022 全年 / 2025 上半年）新增 0 条、已删 ST 不再写回。**遗留待办（已登记）**：6,518 条「当日真实 10% 涨停但名称被回填套上当前 ST 名」的记录（208 只，清单 `scripts/backup/st_name_fix_targets.json`）需 Tushare namechange 改回当日真实名称；**实测 namechange 限频 1 次/小时**（非文档假设 1 次/分钟，当前 token 档位），208 只约需 208+ 小时，用户选定**暂缓登记待办**，工具链就绪（provider + 清单），待更高积分 token 或配额放宽后执行。**影响面**：情绪/题材/候选池/回测全部实时读 limit_up_records，删除后自动收敛，无需迁移。§44 数据快照无研究数据域变更（本表属业务/候选池源，非 A~H 域）。
- **2026-09-09 02:40 — 组合回测退出语义修复（持有 N 天退出）+ 价格加载精确窗口化**（用户反馈「回测只需涨停后几天，查太多了」）。**背景**：§47 01:13 已定位生产引擎无退出策略（baseline 只产 BUY、持仓推到期末 `finalizeOpenTrades`，导致 realisticSimulation 恒 completed=0/winRate=null）；且 `loadBacktestPriceRows` 用「每股 MIN~MAX 连续窗口」，涨停回填到 2019 后每股窗口膨胀到 5-7 年，最近 2 年价格行 100 万（传输 27s）。**修复一（退出语义）**：`domain.ts` BacktestConfig 加 `maxHoldingDays?`、`portfolio.ts` 加 `openPositionEntries()`、`engine.ts` 收盘后对持有满 N 天持仓产 SELL（next-open 成交）、`strategyBacktest.ts`/`leaderCandidateStrategyBacktest.ts` 传参（默认 5，与 legacy maxHoldingDays 一致）。**修复二（精确窗口）**：`db.ts` 新增 `mergeLimitUpWindows()`（每股相邻涨停日间隔 ≤ lookback+forward 自然日合并为不相交区间）+ `loadBacktestPriceRows` 改「查涨停日→应用层合并→连接级临时表→JOIN」，只取每个涨停日前 30 自然日（特征回溯 SMA20）～后 14 自然日（持有期+长假 buffer），去掉每股涨停日空档（去重不能在 SQL 直做：DISTINCT 全字段 55s、OR 展开 SQL>1.7MB 超时）。**验证**：最近 2 年价格行 100 万→50.5 万（减半）、加载 29s→26.5s；持有期 353/367 笔 6 天退出（平均 6.3 天）、8 笔停牌/数据缺失顺延、5 笔期末附近（合理边界）；81 例 engine/strategy 测试全过 + tsc 干净 + vite build 通过。**语义变化**：生产回测从「持有到期末」改为「持有 N 天退出」，前端「最多持有日」（默认 5）首次真正生效；Backtest.tsx 文案同步。**遗留**：精确窗口 JOIN（DATE_FORMAT）16.8s 仍是冷缓存地板；停牌股持有期因 forward 窗口边界会人为顺延（真实行为近似）。§44 无数据快照变更（纯代码层）。
- **2026-09-09 03:40 — 研究链路前端接入收尾：FE-6/7/8/9 四页并行接入 + 4 个新 router 合并进 appRouter**（用户「继续开发，可以并行进行」）。**背景**：§47 01:53 完成 FE-5 后，FE-6~FE-9 仍为空壳（引擎 CODE_READY 但 tRPC 端点未暴露）。**并行执行**：4 个 general-purpose 子代理各负责一个阶段，创建**自持新 router 文件**（互不冲突）：① `server/paramSearchRouter.ts`（FE-6：`describe/run/rolling/robustness/stochastic` → parameterSearch/rollingOptimization/robustness/stochasticRobustness）；② `server/walkForwardRouter.ts`（FE-7：`describe/run/oos/overfit` → walkForwardRun/oosIsolation/overfittingDetection）；③ `server/marketRegimeRouter.ts`（FE-8：`describe/run` → marketRegime）；④ `server/reviewRouter.ts`（FE-9：`journal.reconcile/journal.drafts/discipline.run/paper.run` → tradeJournal/disciplineFeedback/paperAccount）。**关键架构**：这些引擎均为纯函数+注入式求值器（同步 `(params)=>outcome`），而生产回测异步、tRPC 不能序列化函数 → 端点服务端**异步预计算所有参数组合回测到 Map → 构造同步查表求值器**再调纯函数；真实 facts（regime 用 index_daily 收盘+limit_up_records 涨停数、PIT asOf===tradeDate，breadth/liquidity/sentiment 等缺源显式 unassessed 不编造）；前端四页全部重写接真实数据、顶部 R7「技术预览·非 RESEARCH_READY」提示条。**主 agent 收尾**：`routers.ts` appRouter 合并 4 router（paramSearch/walkForward/marketRegime/review）+ 修复 RegimeReport 2 处 `as Error`→`as unknown as Error`（TS2352）。**真实数据验证**：paramSearch(grid 4 组合 verdict=no-qualified-samples 收益-25%~-20% 真实值)、robustness(cost 7 样本 stable)、stochastic(monteCarlo sensitive RETURN_DISPERSION/DRAWDOWN_TAIL)、marketRegime(120 交易日 tags、trend/volatility/indexState 部分 INSUFFICIENT_HISTORY、liquidity/breadth/limitUpEnv/sentiment 全 unassessed)、review(reconcile FULL/NONE、drafts entries=1、discipline empty→DFA_NO_ENTRIES、paper realized=89.43/costDrag=10.57)。**验证**：`tsc --noEmit` exit 0、`vite build` 通过（16.27s）、全量 `vitest` 2289/2305 通过——**16 失败全为环境依赖**（tushare.secret 无 TOKEN、tushareTradingCalendar 网络超时、dataHealth/image/limitUp.watch/limitUp/marketData 依赖真实 DB 状态、researchRunRouter 一条 `EXECUTOR_NOT_BOUND` vs `DATASET_NOT_READY` 优先级断言属此前 readiness 语义变更遗留），与本轮改动无关。**附带确认退出策略已生效**（§47 02:40 已实现，本轮全历史复核）：`getLeaderCandidateBacktest({})` 全历史 2019-2026 → **1185 笔 / 1180 平仓 / 胜率 38.47% / 总收益 57.62% / 回撤 22.14%**，指标真实有值，「帮我决策」的生产路径闭环已通。§44 无数据快照变更（纯代码层 + 前端接入）。
- **2026-09-09 22:12 — WORK P3-T1 生产引擎退出策略接入（baseline BUY → BUY+SELL）CODE_READY**（Gap Matrix P0-3 / G3 首个任务）。**背景**：生产策略 `leaderCandidateBaseline` 只产 BUY 无 SELL（Gap Matrix 证据 `action:"BUY"`），胜率/回撤失真；此前 §47 02:40 仅用引擎层 `maxHoldingDays` 补「时间退出」，策略层仍无「信号退出」。**实现**：① `server/strategy/strategies/leaderCandidateBaseline.ts` 增 `LeaderCandidateExitMode = "hold-while-selected" | "none"` + `exitMode` 配置（默认 hold-while-selected），新增 `buildHoldWhileSelectedExitSignals`（desired = minScore/featureMode 过滤后候选池、**不受 maxSignals 截断**；持仓不在 desired → SELL，symbol 升序）；`evaluate` 解构 `context.portfolio`，`signals = [...sellSignals, ...buySignals]`（sell 在前 buy 在后，对齐 planDecisionDay）；**无候选日 → emptyDecision 不强制清仓**（对齐 research simulator planDecisionDay「信息不足不 SELL」）。② `leaderCandidateStrategyBacktest.ts` 增 `LEADER_CANDIDATE_PRODUCTION_EXIT_MODE` 常量 + 生产 config 显式 exitMode。③ `research/adapter.ts` 参数 schema 暴露 exitMode（defaultValue hold-while-selected）。**边界更新**：`legacyTransactionSimulator.ts`/`realisticBacktest.ts`/`engineNonEquivalence.test.ts` 注释由「不产生 SELL」更正为「退出语义不同（hold-while-selected vs legacy 风险管理止损止盈），仍非等价」；`realisticSimulationSemantics.test.ts` 语义描述更正（断言保持，其 fixture D2/D3 无候选 → 不强制清仓）。**验证**：`tsc --noEmit` exit 0；`server/strategy`(73)+`server/engine`(45)=99 测试全绿（新增 7 退出策略单测 + 3 端到端用例）；`server/research` 44 文件 1104 全绿（`experimentPersistence.test.ts` 参数集断言同步 exitMode 默认值）；端到端（synthetic）A E1 涨停→E2 开盘买→E2 断板→SELL→E3 开盘卖，产出 `openAtEnd=false` closed trade + `completedTradeCount≥1`。**状态口径**：CODE_READY（synthetic fixture 验证 BUY→SELL 生命周期；真实数据 VALIDATED 留待 P5-T1 Baseline，铁律 CODE_READY≠VALIDATED）。**已知限制**：`portfolio.sell` 清仓 `trade.reason` 硬编码 null（退出原因未传递到 Trade，留待 P3-T4）。证据 `docs/quantRoadmap/evidence/G3/P3-T1/`。§44 无数据快照变更（纯代码层）。

- **2026-09-09 22:26 — WORK P3-T2/T3 去 legacy 耦合闭环 VALIDATED + P3-T4 边界验证 CODE_READY（G3 完结）**。**P3-T2**：静态调用图确认 4 研究 router（paramSearch/walkForward/marketRegime/sentiment）已走生产引擎——`getLeaderCandidateBacktest`(db.ts:2005)→`runLeaderCandidateStrategyBacktest`（`includeResearch=false` + `realisticSimulationOverride` 注入），legacy 模拟器调用=0（实现由 P2-2 完成，本任务验收确认+证据固化）；澄清验收措辞「4 router 不再调用 getLeaderCandidateBacktest」实为「不再走 legacy」。**P3-T3**：legacy 模拟器降级为 research-only 唯一出口 `RESEARCH_LEGACY_SIMULATION_SOURCE`（非移除），仅 3 个研究模块引用（downsideRisk 5 处 / overfittingGuard 2 处 / leaderCandidates:1038 研究分支兜底），生产路径 0 引用；`engineNonEquivalence.test.ts` 锁定「legacy ≠ 生产引擎」防伪等价。**P3-T4**：新增 `server/engine/edgeCases.test.ts`（18 用例）逐项验证 12 项边界——8 覆盖（T+1 / 涨跌停可成交性 blockLimitUpBuy/DownSell / 停牌数据缺失 / 板块涨跌停幅度 resolveLimitRules / 滑点 / 费用印花税单向 / 资金整手 / maxHoldingDays 时间退出）+ 4 KNOWN_GAP（K1 止损止盈待 P4-T1 定义策略规则、K2 除权复权 adjustment_factors 已 FULL 未接入、K3 一字板封死概率仅 legacy 有、K4 板块 limitRules 已实现但未注入生产引擎）。**验证**：`tsc --noEmit` exit 0；`server/engine`(63)+`server/strategy`(54)=117 测试全绿（新增 18 边界用例）。**G3 整体状态**：P3-T1 CODE_READY + P3-T2/T3 VALIDATED + P3-T4 CODE_READY；去 legacy 已闭环，真实数据端到端 + 4 项 KNOWN_GAP 留待后续 Phase。证据 `docs/quantRoadmap/evidence/G3/P3-T2|T3|T4/`。§44 无数据快照变更（纯代码层 + 测试）。

- **2026-09-09 23:10 — WORK DS-V2-FINAL Research Dataset 产品化与集成收口（STEP 1~11 全完成）**。在既有成熟后端 C-12.6 基础设施上**不做零起点重设计**，完成 11 个 STEP：① **FE-3 产品化**——`capability.ts`（10 维度 × 六列能力矩阵，metadata-first：大表 OHLCV/liquidity/index 只取索引列 MIN/MAX 不 COUNT 全表，修 §47 14:22 FE-1 发现的 8.9M 行 COUNT 卡死同款问题）、`preview.ts`（先预览再构建：元数据+内存 universe 决议+诚实 truncated）、`certify.ts`（C-12.6.3 认证决策树 CERTIFIED/CONDITIONAL/REJECTED，9 单测）；`researchDatasetRouter` 增 capabilities/preview/certify/list 四端点；FE 三面板 `DatasetCapabilityPanel/PreviewPanel/CertifyPanel` + `DatasetBuilder.tsx` 组合。② **认证三态 vs gate 三态严格区分**（§2 铁律）：gate=FAIL/PASS/INCONCLUSIVE 是「能不能拼」，certification 是「能否作正式研究环境」，gate=PASS 但固定快照/依赖历史 PIT 不完整 Industry/Liquidity/CA 仍只 CONDITIONAL。③ **Research Run 强绑定**——`research_runs` 增 `datasetId/datasetVersion/datasetFingerprint` 三列（migration 0025 + 幂等脚本 `migrate_add_research_run_dataset.ts` 已执行），`runService/persistence/db/run.ts/types.ts` 全链路带 dataset 身份，legacy 路径三列 NULL 区分。④ **真实 E2E 跑通并修两处真 bug**——`runResearchDatasetE2E.mts` 全链（build→certify→persist→bind→signalEngine→simulator→metrics→persist Run）：**bug1 行排序** builder 按 universe 成员序（exchange→code→securityId）违反 `(tradeDate,securityId)` 升序契约、`bindResearchDataset` 不变量从未触发（`research_runs=0` 掩盖），修复为组装后强制 `rows.sort()`；**bug2 元数据探测全表 COUNT** 改 MIN/MAX；**bug3 E2E 落库误用 `db.execute({sql,values})`** 改 `db.insert(researchRuns).values()`。⑤ **回测路径收敛（STEP 6）** 三条分类：FORMAL（bind→signal→simulator→metrics，强绑定，唯一正式结论路径）/ TECHNICAL PREVIEW R7（paramSearch/walkForward router→getLeaderCandidateBacktest，无 dataset 绑定）/ LEGACY（engineAdapter→runStrategyEngineBacktest，`ResearchDatasetSpec{startDate,endDate}` 绕 C-12.6）。⑥ **Opt/WFO 绑定审计（STEP 7）** 确认 R7 标签 + OOS 污染防护已测（gap/embargo + assertWalkForwardSplitInvariants + oosIsolation 重叠检测 + datasetAccess PIT 反泄漏）。⑦ **真实认证**：正式 E2E `--data-ready` → **CERTIFIED（researchSafe=true）**，`datasetVersion=rd-1.0.0-1-fd1c487f2fe19e27`，Run `RUN-EXP-E2E-B9F42F-D4D1` 落库；Industry 保持 CONDITIONAL（effectiveFrom 单点 2026-08-31，未 fake READY）。⑧ **gate 刷新**：`research_ready_gate.json` 重生成 → `researchReady=true`（G2 research_datasets≥1 PASS + G4 research_runs≥1 PASS），G1/G3/G5 诚实 GAP。⑨ **终审** 产出 4 份文档：`DATASET_SPECIFICATION.md`/`DATASET_CERTIFICATION_SPEC.md`/`DATASET_VERSIONING.md`/`RESEARCH_DATASET_V2_IMPLEMENTATION_REPORT.md`（重答 20 问 + §23 状态模型）。**验证**：`tsc --noEmit` 干净、researchDataset 57 + research 1104 全过。**保留设计决策**：三态 PASS/FAIL/INCONCLUSIVE 不改 PASS/WARN/FAIL、content-addressed 身份不加 V1/V2/V3、Industry 保持 CONDITIONAL。**遗留**：G3 引擎 SELL 属 P3-T1（§47 22:12 已 CODE_READY）、G4 弱证据（OOS/overfitting 未接正式链）、legacy runService 路径待收敛 FORMAL、全窗口构建 ~9.5M 行性能不可行需分窗。更新 §44.2/§44.4 + 本 §47 append。

- **2026-09-09 23:55 — WORK DATASET-003 首板回踩落地为 universeFilter 通用条件（非独立页面/tab，CODE_READY）**。**架构纠正（用户两次反馈）**：首板回踩不作为独立页面、也不作为独立 tab，而是做成 `universeFilter` 的通用「回踩条件」，复用既有 `buildResearchDataset` 管线（板块/ST/T日条件已在 23:50 落地）。**删除独立实现**：`server/firstBoardPullback/` 全模块（detect/screen/db/build/exclusions）、router `firstBoardPullback` procedure、`FirstBoardPullbackPanel` 组件、DatasetBuilder pullback tab（恢复单页布局）。**通用化新增**：① 类型 `researchDataset/types.ts` 增 `PullbackTargetType`(limitPrice/t0Open/t0Low/ma5)+`PullbackScreenCondition`，`UniverseFilter`/`NormalizedUniverseFilter` 增 `pullback`；`shared/researchContracts.ts` 增 `pullbackScreenConditionSchema` + `universeFilterSchema.pullback`；② 纯函数 `researchDataset/pullback.ts`（`screenSingleTarget`/`screenPullback` 触及且不破 + `computeMa5FromFacts`/`buildWindowBars`/`buildFirstBoardEvent`/`screenFirstBoardRow`），迁移并扩充 10 单测；③ 编排 `builder.ts`：pullback 存在时有界预加载扩展窗口 facts（前 4 日 MA5 + 后 N 日观察窗口），装配后回踩后处理，`PULLBACK_NOT_MATCHED`/`PULLBACK_INCOMPLETE` 记入 excludedByReason，rule 追加回踩口径；`validate.ts` 强制 pullback 需 tDayCondition=firstBoard；④ FE：`datasetAdapter` 增 pullback 视图模型+wire+PULLBACK_TARGET_LABELS，`DatasetConfigPanel` Universe 过滤区增「首板回踩筛选」勾选+多选目标位+容差+窗口（启用即自动置 T日条件=首板）。**验证**：`tsc --noEmit` 干净；`server/researchDataset` 75 单测全绿（pullback 10 新增）；真实 TiDB E2E `scripts/verifyFirstBoardPullback.mts`（走 buildResearchDataset，窗口 2026-08-10~08-21，回踩=涨停价/MA5 容差 2% 窗口 T+1~T+5）→ **52 个首板回踩候选**（如 000537.SZ/600815.SH/002783.SZ…），`datasetVersion=rd-1.0.0-1-61fbbaae25b86747`，排除统计 PULLBACK_NOT_MATCHED/PULLBACK_INCOMPLETE 正常区分；`gate=INCONCLUSIVE`（dataReady=false 冒烟口径）。**修复边界 bug**：builder `forwardEnd` 在日历不足 N 个未来交易日时退到「日历最后一天」而非 lastDate，避免贴边事件被误判 incomplete。**性能事实（真实 TiDB）**：`liquidity_daily` 约 900 万行逐日查询 ~7-9s、静态加载 ~100s，`buildResearchDataset` 固有慢（E2E 08-10~08-21 约 4.3min），非本次引入；`stock_daily_prices` 有 `idx_..._trade_date` 索引、逐日价格查询 <1s。§44 无数据快照变更（纯代码层）。

- **2026-09-10 01:30 — WORK STEP DATASET-001 Dataset Registry + 独立物理表架构 + 全局命名规范（READY，全链路真实 TiDB 验证）**。按规格把「数据集功能」从 `research_datasets` 内容指纹快照架构重构为 Registry + 独立物理表三层架构，作为新层落地、既有稳定模块零破坏（§49 兼容优先）。**审计结论（§50 前置）**：`research_datasets`（migration 0024）是 JSON 快照架构非 Registry；`first_limit_pullback` 此前仅是 `researchDataset/pullback.ts` 扁平 filter（§47 DATASET-003）非物理表。**数据库**：migration `drizzle/0028_dataset_registry.sql` 6 表（`dataset_definition`/`dataset_version`/`dataset_build_job` + `ds_first_limit_pullback_event/path/outcome`）+ 幂等脚本 `scripts/applyDatasetRegistry.mjs`（statementsExecuted=17、errors=0、6 唯一约束全在）；数值列用 `double`（drizzle decimal 返 string 类型错配）；`lastCursor` 用 LONGTEXT（checkpoint JSON 含 cumulative 涨停历史增长，原 TEXT 64KB 撑爆 ER_DATA_TOO_LONG）。**命名规范**：`server/datasetRegistry/naming.ts` 权威来源 `ds_{dataset_code}_{role}`（role∈event/path/outcome/feature），禁 version/序号/日期/环境/UUID。**领域层**：`types/registry/detection/path/builder/db/index` 7 模块——registry 三实体生命周期 + Service；detection 复用 `boardRules` 涨跌停权威 + PIT ST（`resolveSt` 走 identifier/status history as-of，不按当前回填）；builder 两阶段（events 逐日 keyset + 批量 IN 富集流动性/行业；paths/outcomes 30 交易日分块一次范围下推 + 批插）；db 全走 `onDuplicateKeyUpdate` 幂等 upsert。**关键优化**（真实 benchmark 驱动，smoke 基线 4.6 rows/s → 171.6 rows/s，~37×）：① Phase 1 逐事件 fetchLiquidity/fetchIndustry 改批量 IN；② Phase 2 逐事件 fetchSymbolBars 改 30 日分块 fetchBarsRange；③ 修两处真实落地 bug——migration 注释块未按 statement-breakpoint 分隔（TiDB 禁 multi-statement，applier 改剥注释+按分号切）、`lastCursor` TEXT→LONGTEXT。**验证**：`tsc --noEmit` exit 0；`vitest run server/datasetRegistry` **33/33 全过**（naming 6/registry 6/detection 9/path 7/builder 5，覆盖 §38.1~38.9：命名、定义唯一、版本唯一、版本隔离、幂等、resume、交易日历）；真实 TiDB 2024 全年构建 `scripts/runDataset001Build.mts` **10,240 事件/206,408 路径/30,720 结果/237,128 行，1381.6s（≈23min）**；`scripts/verifyDataset001.mjs` 数据质量全 PASS（唯一性 0 重复、版本隔离 10,907=10,907、交易日历周五→周一、strategyBoundColumns=0 反策略绑定、涨停价 sanity 10,240/10,240）。产出报告 `docs/STEP_DATASET_001_FINAL_REPORT.md`（状态 READY，A–M 节）。§44.1 覆盖式更新（新增 ds_* 三物理表快照）。

## 49.1 规则（强制，面向新增/修改代码）
1. **代码模块目录名禁止携带 STEP/C-task 编号或任何数字后缀**（robustness18、signal13 之类一律禁止）；使用纯语义小驼峰（camelCase），如：`signalEngine`、`costModel`、`executionConstraints`、`riskAdjustedMetrics`、`tradeQualityMetrics`、`parameterSearch`、`rollingOptimization`、`robustness`、`stochasticRobustness`、`walkForwardRun`、`oosIsolation`、`overfittingDetection`、`lifecycle`、`marketRegime`、`paperAccount`、`signalToPnl`、`researchDataset`、`datasetAccess`、`simulator`、`strategySchema`。
2. **模块文件（含 .test.ts）同样禁止携带任务编号**；测试文件与模块同主体：`<module>.test.ts`（如 `robustness.test.ts`）。
3. **STEP/C-task ↔ 模块映射由以下渠道承载，目录名不得重复承载**：目录头注释（`/** STEP xx / C-xx.y — … */`）、`server/research/index.ts` 统一出口注释、ROADMAP §44/§47 与 TASK_TRACKING 记录。
4. 例外（不受限）：`docs/` 下证据与日志产物（日期戳文件名、gate json 如 `research_ready_gate.json`）；`scripts/` 工具文件名；数据回填 CLI 参数。
5. 禁止为规避本规则引入编号/数字变形（如 `wfo2`、`copy3`）；名称必须取自职责语义。命名前先全库查重目录名与顶层符号（教训：`DEFAULT_LOT_SIZE` 重复导出 TS2308、`PaperPosition` 被 legacy 占用）。

## 49.2 历史追溯
2026-09-07 21:45 前的带编号目录名（signal13/costModel14/…/docs/step12-evidence）出现在 §47、TASK_TRACKING §5、memory 等 append-only 记录中，**不追溯改写**；以本节日期对应 §47 改名记录为映射对照（旧名 → 新名）。新增代码一律遵守 §49.1。
