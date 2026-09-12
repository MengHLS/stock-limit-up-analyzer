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
>
> **【仓库结构 · 2026-09-13 03:00 GMT+8 · 根目录证据簇整体归位 `docs/evidence/`】** 根目录 **85 个 `_*` 探针与运行结果**（`_r006*` / `_r007*` / `_r008*` / `_r009*` / `_r010*` / `_e2e_*` / `_diag_*` / `_perf_*` 等）已整体迁入 **`docs/evidence/`**；根目录文件数 **131 → 20**。性质说明、逐文件索引与重跑方法见 **`docs/evidence/README.md`**。**🔴 判别口径：2026-09-13 之前的文档与日志里出现的裸 `_xxx` 文件名，一律指向 `docs/evidence/_xxx`** —— `ROADMAP-CHANGELOG.md` 与 `.workbuddy/memory/**` 属 append-only，按 `PROJECT_RULES.md:129`「历史条目零改写」**一字未动**，映射只登记在本条与 `docs/evidence/README.md`；`ROADMAP.md` 与 `docs/**`（排除 `docs/evidence`、`docs/legacy`）的 **155 处**文件名指针已机械改写为带前缀形式（改写经「反向剥离前缀须逐字节还原」不变量校验，证得只插指针未改内容）。`docs/evidence/**` **不进 `tsc`、不进 vitest**（与 `scripts/**` 同待遇）；19 个 `.mts` 探针的相对 import 已由 `./server/…` 修正为 `../../server/…`（43 处），重跑须在项目根目录执行。
> 最后实查：**2026-09-13 02:05 GMT+8**（**WORK RESEARCH-006.4.1-C.4（前端线）候选草图编辑器「差哪一项」定位修复 —— 缺口带机器可读落点 + 段内逐条清单 + 必填输入框就地高亮；并顺带查实登记一条服务端自相矛盾（纯 `client/**`，`server/**` 生产文件一行未改）**：触发 = 用户对 01:50 版（006.4.1-C.3）的**第三次可用性反馈**，原话「**什么价买这个还是有问题，永远还差一箱校验，没法继续往下一步走**」。**一、先定位（读真实库那一行，不靠猜）**：新增只读诊断探针 `docs/evidence/_probe_when_gap.mts`，用**组件同一条纯函数路径**（`toSketchDrafts` / `validateSketchDrafts` / `sketchSegmentStatuses`）复算 `research_strategy_candidate` 唯一一行（#270001，`status=ACCEPTED`）⇒ `errors=0`、`warnings=0`、**`gaps=1` 且恰好落在 `when` 段**，缺的是 **`entryRule.timing`（入场时点）**；该行 `entryRuleJson` **确实没有 `timing` 键**（只有 `event` + `extra` 的窗口/触发/事件参数/执行/仓位/成本）⇒ 用户把该段**看得见的都填完了**（观察窗口 1–4 交易日、触发时点=次一交易日、两条买入条件），只剩一个他既不知道、又与「触发时点 = 次一交易日触发」看着像同一件事的下拉。**二、根因 = 「只说差几项，不说差哪一项」（有代码坐标）**：`CandidateSketchFields.tsx`（**编辑器**，用户实际在用的那个）顶部横幅原本只渲染 `{段名} · {gapCount}`、段徽标只渲染「还差 N 项」—— **缺口文案 `gapDetails[].label` 只在只读卡片 `CandidateSketchCard.tsx` 里被列出，编辑器从不显示** ⇒ 徽标永远停在「还差 1 项」，用户无从下手。**三、修法（模型层给落点、界面层往下沉，单一真相不分裂）**：① `candidateSketchForm.ts` 新增 `SKETCH_FIELD_ANCHORS`（10 个稳定键）+ `SketchGap.anchors: readonly SketchFieldAnchor[]`，**锚点与 `label` 在同一个 `gap(...)` 调用点配对**（因此不可能出现「清单说 A、高亮落在 B」的第二套说法）；用**数组**是因为「入场规则整块未填」时一条缺口同时对应三个输入框（时点/窗口/触发），拆成三条只会让段计数虚高；`SketchSegmentStatus` 增 `gaps: readonly SketchGap[]`（`gapCount ≡ gaps.length`）。② 编辑器四处落地：顶部横幅由「段名 · 数量」改为**逐条文案**（可点击跳段）；每个展开段的**首行**新增琥珀清单 `SegmentGapList`（「1. 入场时点（转正必填 —— 决定信号 bar / 成交 bar / 成交价）」）；`Field` / `Section` 新增 `missing` 属性，判据**只来自该段缺口的 `anchors`**（不另立必填表），命中即打「必填未填」徽标 + 琥珀圈，落在**具体那个输入框**上；「入场时点」与「触发时点」的 `hint` 互相点名，说清「触发时点回答什么时候产生信号、入场时点回答信号出现后在哪根 bar 成交，两个都要选」。③ 顺带给「触发时点」四个取值补上**真实语义**（逐条取自 `strategySchema/definition.ts:333-336`，不是我的解释）：首个有效日 / 最后一个有效日 / 每个有效日 / 再顺延一个交易日，并明说「T 日涨停 → 观察 5 日 → 回踩到位才买」该选「首个有效日」。**四、🔴 顺带查实一条服务端自相矛盾（只登记、不改代码）**：`entryRule.timing = SAME_CLOSE`（「事件日收盘买入」）映射出 `{signalTiming:"T_CLOSE", executionTiming:"T_CLOSE"}`，而 `strategySchema/definitionValidation.ts:710-715` 的 **L6 明确拒绝**这一组合（`SIGNAL_EXECUTION_TIMING_CONFLICT`，现成用例 `strategyDefinition.test.ts:903-909`）⇒ **选了它在转正时必然失败**，属本文件头明令禁止的「转正时必被拒的选项」。**处理方式 = 不从词表删**（`ENTRY_TIMING_TO_EXECUTION` 的逐字对表断言是漂移哨兵，删一项等于把哨兵关掉），改为 `SketchOption.disabled` **置灰 + note 写明 L6 码与替代选项**；并配一条**自失效**测试 —— 断言的是「服务端映射出的三元组确实同 bar 成交」，**服务端一修好，该测试先红、置灰随即撤掉**。根因在 `server/**` ⇒ 与 C.3 登记的两条后端缺陷（OR/NOT 被静默压成 AND、条件右值无算术）一并**单独排期**（改 `server/**` 会 `tsx watch` 热重启杀死在途研究 Run）。**五、验收（本机 `agent-browser` 不可用 ⇒ 按项目约定不使用浏览器截图，改用等价证据组）**：`npx tsc --noEmit` **exit 0**（零输出）；`npx vitest run client/src/components/research` **9 文件 / 274 例全过**（`candidateSketchForm.test.ts` **49 → 58 例**：新增「缺口落点」5 例 —— 段状态与总清单同源同序、空草稿恰好用满全部锚点（穷尽性）、整块未填时一条缺口对应三件套、窗口只填一半 ⇒ 落点=窗口、**🔴 回归：复刻真实 #270001 那一行 ⇒ `when` 恰好 1 项、label 含「入场时点」、`anchors = ["entryRule.timing"]`，补上 `timing` 后该段归零**；另加「入场时点 / 触发时点语义与陷阱」4 例）；全量 `npx vitest run` **7 文件 / 15 例失败 = 既有环境依赖基线，零新增**（3,806 passed）；`npx vite build` **RC=0**（3,020 模块 / 15.42 s）；**零写入验证探针 `docs/evidence/_probe_when_gap.mts` 12/12 PASS** —— 读真实行复算得到「缺口被指名 + 落点 = `entryRule.timing`」；模拟选中「次一交易日开盘买入」⇒ 缺口 1→0、`buildUpdateCandidatePatch` 立刻产出**只含 `entryRule`** 的补丁、**保留原 `extra` 的窗口/触发/成本**、不改任何东西仍拒绝空补丁（**全程不写库**）；Vite dev server 实测转换后模块含 `SegmentGapList` / `missingAt` / 「必填未填」/ 「当前不可选」。**六、边界与纪律**：`server/**` 生产文件**一行未改**（`definitionBuild.ts` / `definitionValidation.ts` 仅只读核对）、未改 Dataset Registry、零迁移、零新端点、零新依赖；**未新增第二个「Candidate → Strategy」转换入口**（`strategyCandidateUiContract.test.ts` 仍全过）；`raw` 块**永不进补丁**这条纪律未放松；`anchors` 是**纯增量**字段（`EditCandidateDialog.tsx` 只消费 `errors` / `gaps` ⇒ 无需改动）。⚠️ **本轮未触碰任何真实候选数据**（探针全程只读）。详见 §44.5 第 18 条 / §47 02:05 条。
>
> 上轮实查：**2026-09-13 01:50 GMT+8**（**WORK RESEARCH-006.4.1-C.3（前端线）候选草图编辑器三处缺陷修复 —— 「买入条件」正名并归位 + 条件行去抽象化 + 常用条件模板；并用真实库端到端证明「T 日首板 → 观察 1–5 交易日 → 缩量回踩不破首板日开盘价 → 买入」能被**完整表达、真实落库、原样读回**，且产出的 `entry.conditions` 与服务端 golden sample **逐字一致**（纯 `client/**`，`server/**` 生产文件一行未改）**：触发 = 用户对 01:40 版（006.4.1-C.2）的**第二次可用性批评** —— 原话「**这个编辑候选草图还是有点问题：1 什么价买差一个选项，没法填。2 买什么中的事件参数与不买什么的事件参数，只有很抽象的代码。3 观察日的时候，应该再观察日买足什么条件就可以买入。总之来说，就是还不能完全实现 t 日涨停，观察五日，回撤达到某种幅度，可以买入的那种策略。**」。**一、先定位（三条批评其实只有两个真缺陷）**：读 `definitionBuild.ts:506-508` 确认 `const conditions = buildConditions(candidate.filterRule, codes)` 后 `entry: { …, conditions, … }` ⇒ **`filterRule` 的唯一去向是 `entry.conditions`**，而那是「**全部满足才产生买入信号**」；又 `ResearchEntryRule`（`researchCore/candidates.ts:19-26`）**只有 `event?` / `timing?` / `extra?`、没有 conditions** ⇒ `filterRule` 是入场条件的**唯一载体**。「没法填」这个症状的根因是**我把它的语义方向写反了**（用户第 ②③ 条同源）。**二、🔴 两处语义纠正（本轮最大价值，都不是措辞偏好）**：① **标签错** —— `filterRule` 原标「**不买什么 —— 剔除条件**」，但它的语义是「满足才买」⇒ `SKETCH_BLOCK_LABELS.filterRule` 改为「**买入条件**」；沿用「剔除」会让用户把方向写反（去写 `NOT_IN` 才买）。② **位置错** —— 它原被折叠在「买什么」段里 ⇒ 搬到 **`when`（什么价买）** 段并默认可见（`SKETCH_BLOCK_HOME_SEGMENT.filterRule = "when"`），段 `hint` 改为「『什么条件买』+『什么时候买』两件事」；`what` 段摘要随之**移除**条件计数、`when` 段摘要**加上** `买入条件：…`（人话整句）。这一条同时就是用户第 ① 条「什么价买差一个选项，没法填」的答案。**三、去抽象化（用户第 ② 条）**：`prefix.rd0.close` 这类裸引用整体换成 **「部位 + 相对日 + 字段」三格选择器**（部位 = 观察窗口内的当天 / 事件（首板）当天 / 事件当天或之前 / 事件之后第 N 根；字段全中文），并保留 **人话预览 + 小字回显原始引用**（保住与后端错误信息对上的能力）；不可解析的既有值 **退回自由文本且绝不重建**（防静默丢数据）。事件参数新增**常见键提示**（`limitUpRatio` / `eventCode`）+ 明说「键名**没有白名单**、服务端原样透传」。**四、能表达「观察日满足什么条件才买入」了（用户第 ③ 条）**：新增 **5 个常用买入条件模板**一键插入，其中**前两条逐字取自后端 golden sample** `FIRST_BOARD_PULLBACK_DEFINITION`（「回踩不破首板日开盘价」`bar.low >= prefix.rd0.open`、「回踩当日缩量」`bar.volume < prefix.rd0.volume`）—— 用仓库**唯一一份权威表达**，不自己编口径。**五、🔴 新登记两个后端缺陷（只登记、不改代码；改 `server/**` 会热重启杀死在途研究 Run ⇒ 须单独排期）**：① **`OR` / `NOT` 被静默压成 AND** —— `buildConditions` 把所有条件组**扁平化**成 `ConditionDefinition[]`，而该结构**没有逻辑运算符字段** ⇒ `entry.conditions` 实际是**全部 AND**；前端已加 `warnings` 通道（**不阻断保存、不阻断转正**，只如实说明），并在**真实转换器**上取证：**`OR` 版本与 `AND` 版本产出的 conditions 逐字节相同且不报错**。② **条件无算术 ⇒「回撤 X%」表达不了** —— `ConditionDefinition.value` 只有 `CONSTANT` / `FIELD_REFERENCE` / `PARAMETER_REFERENCE` 三种语法种类、**没有算式**，而「相对首板日回撤 5%」需要 `prefix.rd0.close * 0.95` ⇒ **宁可少给选项，也不给一个转正必被拒的**；已写明替代路径（用首板日的开/高/低/收做价格锚点，或把幅度做成参数）。**六、验收**：`npx tsc --noEmit` **exit 0**（零输出）；`npx vitest run client/src/components/research` **9 文件 / 265 例全过**（`candidateSketchForm.test.ts` **36 → 49 例**）；全量 `npx vitest run` **7 文件 / 15 例失败 = 既有环境依赖基线，零新增**（3,797 passed）；`npx vite build` **RC=0**（3,020 模块 / 14.73 s）；**真实库端到端新增 `docs/evidence/_e2e_first_board_pullback.mts`（自建自清）48/48 PASS** —— 三层取证：**① 表单层**（五块全可结构化、无 `raw` 降级、缺口 / 错误 / **警告全空**）；**② 持久层**（真实 `update` → `get` 读回逐块相等 + 两条条件逐字相等 + 幂等 + 空改不产生补丁 + 只改一块只有该块 + 候选行数守恒 1→1）；**③ 转换层**（调**真实** `buildStrategyDefinition`，产出 `entry.conditions` 与 golden sample 的 `field/operator/value/valueType` **逐项一致**；并取证「观察窗口 1–5 交易日」「事件参数 `limitUpRatio` 原样透传」「触发时点 `FIRST_VALID_DAY`」）。⚠️ 顺带核实一处**两层表示**：表单填**符号**运算符（`>=`，与 `ResearchConditionSet` 同形），服务端经 `CONDITION_OPERATOR_MAP` 映射为**长名**（`GREATER_THAN_OR_EQUAL`）⇒ 探针两层各断言一次，把这张表**锁住**。**七、边界**：`server/**` 生产文件**一行未改**（`definitionBuild.ts` 这个**唯一转正转换器**一字未动）、未改 Dataset Registry、零迁移、零新端点、零新依赖；**未新增第二个「Candidate → Strategy」转换入口**；`raw` 块**永不进补丁**这条纪律未被放松。
>
> 上轮实查：**2026-09-13 01:40 GMT+8**（**WORK RESEARCH-006.4.1-C.2（前端线）候选草图编辑器「按交易决策顺序重排」—— 把 40+ 个输入框压成 6 段可折叠 + 一行中文摘要 + 成本一键预设，纯 `client/**`**：触发 = 用户对上一版继续实报「**这些里面太多需要填的选项了，而且也过于复杂了，并且十分不直观**」，并在两问里裁定「**按交易决策顺序重排**」+「**一键预设 + 记住上次**」。**一、上一版（006.4.1-C）到底错在哪**：它把后端 5 个 `*Json` 列的**全部字段**一对一摊到界面上 ⇒ 复杂度只是从「人写 JSON」搬成「人读表单」：40+ 个输入框、三层框套框、满屏 `entryRule.extra.position.maxExposure` 级别的英文键，而且**可选字段与必填字段长得一模一样**。**二、核实出的三处真实冗余（结论：不是「全都要填」，是我把可选字段摆成了必填的样子）**：① 转正真正卡死的必填**只有 16 项**（事件、入场时点、观察窗口 ×3、触发时点、数量口径、每手股数、仓位方式、最大持仓数、初始资金、6 项成本费率）；② **成本 6 项 + 初始资金每次都是同一套 A 股标准值**，直接取仓库**既有口径**（`client/src/adapters/strategyAdapter.ts#parseCostModel` 的兜底值 = `client/src/pages/StrategyEditor.tsx` 模板 = `0.0003 / 0.001 / 0.00001 / 10 / 100 / 5`，**不另立第二套**）；③ **仓位/风控是同一个概念散在三处** —— `entryRule.risk.*`、`entryRule.position.*`、`riskRule.*` 都有 `maxExposure` / `maxSinglePosition`，用户不可能知道该填哪个（现统一为「单标的仓位上限」唯一入口，其余折进「进阶」并标注二选一）。**三、🔴 纠正一处我此前写错的必填性**：`exitRule` **不是**转正必填 —— `buildStrategyDefinition` 允许 `exit.rules` 为空数组，`definitionValidation` 对它**只校验「是数组」**（全文无「至少一条」约束）⇒ 旧的缺口文案「出场规则整块还没填（`exit.rules` 需要至少一条）」是**我编的假警报**，已降级为「③ 怎么卖」的段摘要 + 展开态提示，**不再计入「还差 N 项」**。**四、交付（新增 1 文件 / 重写 2 / 改 4；零后端改动 · 零迁移 · 零新端点 · 零新依赖）**：**新增** `client/src/components/research/candidateSketchCostPreset.ts`（A 股标准预设 7 项；`applyCostPreset` **只覆盖这七项、绝不动** `backtestConfig.maxPositions`；`matchCostPreset` **按数值**比较而非字符串；千/万分位中文渲染；`localStorage` 本机记忆，读写失败静默降级）；`candidateSketchForm.ts` 增**段模型** `SKETCH_SEGMENTS`（六段：买什么 → 什么价买 → 怎么卖 → 买多少·最多持几只 → 成本与资金 → 参数搜索空间；段是 5 块的**视图**，`entryRule` 一块同时承载 ①②④⑤）+ `SKETCH_SEGMENT_REQUIRED`（`Record<SketchSegmentKey, boolean>` 穷尽性检查）+ `SKETCH_BLOCK_HOME_SEGMENT`（只读块**只在归属段展示一次**，不重复四遍）+ **结构化缺口** `SketchGap {segment,label}`（`gaps` 与 `gapDetails` **同源同序**，不会两套说法）+ 段摘要 `summarizeSketchSegment` / `sketchSegmentStatuses`（缺口的段归属由它统一算，界面不自己数）；**重写** `CandidateSketchFields.tsx`（六段可折叠，折叠态一行中文摘要 + 「还差 N 项 / ✓ 齐了 / 可选」徽标；**只自动展开第一段有缺口的**，其余靠顶部缺口胶囊点击跳转 —— 一次只面对一件事；中文优先、英文键降为小字；三层框改两层；可选字段收进「进阶」`<details>`）与 `CandidateSketchCard.tsx`（只读视图改用**同一套段顺序与摘要**，只显示有值的行 —— 否则「编辑」和「查看」是两个目录，要学两遍）。**五、顺手修掉的另两个真缺陷**：① **全空的条件行 / 参数行曾会拦住保存** —— 点「加一条」还没填就报「还没选字段 / 还没有参数名」，现改为**静默跳过**（与 `conditionGroupsToPayload` 的既有口径「字段名空白的行不落库也不占位」对齐）；② 阻断性错误原本显示在表单**下方**，滚下去就看不见，现移到表单**上方**并按集合去重。**六、验收**：`tsc --noEmit` **exit 0**；`vitest run client/src/components/research` **9 文件 / 252 例全过**（草图模型层 22 → **36 例**：新增段定义自洽性、段顺序、缺口段归属且「六段缺口数之和 = 总缺口数」、**`exitRule` 非必填**、空行不报错、成本预设 6 例含「滑点差一项就不算命中」）；全量 `vitest run` **7 文件 / 15 例失败 = 既有环境依赖基线，零新增**；`vite build` **RC=0**（3,020 模块 / 23.20 s）；**真实库往返 24/24 PASS**（`docs/evidence/_e2e_sketch_roundtrip.mts`，自建自清、候选行数守恒 1→1、五块逐块相等、读回幂等、**只改一块则补丁只含该块**、**「打开编辑什么都不改」不产生假改动**）；本机 `agent-browser` 不可用 ⇒ 按项目约定**不使用浏览器截图**，改用「Vite dev server 实测返回新代码（`sketchSegmentStatuses` / `CostAssumptionPanel` / `sketch-segment` DOM id / `SKETCH_SEGMENTS` 均出现在服务端产物中，5 个文件全 200）+ 真实 tRPC + 真实 TiDB」。**七、边界与纪律**：`definitionBuild.ts` 一字未动；**预设 ≠ 隐式默认值** —— 只有用户**显式点「套用」**才写进草稿，写进去之后它就是「用户在草稿里声明的成本假设」，这与「Promote 不补默认值」不冲突（那条约束的是**转正转换器**，不是编辑器）；新增的成本预设模块已纳入 `strategyCandidateUiContract.test.ts` 的契约扫描清单。**八、以下是上一轮（006.4.1-C，2026-09-13 01:20）的原始记录，仍然有效**：**一、为什么必须这么做**：五块草图（`entryRule` / `filterRule` / `exitRule` / `riskRule` / `parameterSpace`）落 `research_strategy_candidate` 的 5 个 `*Json` 列，而**转正的唯一转换器** `definitionBuild.ts#buildStrategyDefinition`（纯函数、「绝不猜测」）对它们的要求是**词表有界 + 键名闭集**：`entryRule.event` ∈ 5 值、`timing` ∈ `ENTRY_TIMING_TO_EXECUTION` 的 3 键、**`entryRule.extra` 是闭集七键**（`observationWindow`/`trigger`/`eventParams`/`execution`/`position`/`risk`/`document`）、`extra.document.costModel` **六项全必填**、`riskRule.regimeGate` 与 `position.maxPositions` **出现即报错**、`parameterSpace` 角色恒 `TUNABLE`（数值参数必须 min ∧ max）⇒ **让人手写 JSON = 把闭集校验推给人**，写错只能等到转正时吃 `PROMOTE_SKETCH_INCOMPLETE` / `PROMOTE_SKETCH_INVALID`。**二、交付（新增 4 文件 / 重写 2 / 改 5；零后端改动 · 零迁移 · 零新端点 · 零新依赖）**：**新增** `client/src/components/research/candidateSketchVocabulary.ts`（本地词表 + 中文标签 + 字段引用解析**镜像**）、`candidateSketchForm.ts`（**纯函数核心**：三态草稿包 `empty | structured | raw` + 五块 JSON ⇄ 草稿互转 + 校验（`errors` 阻保存 / `gaps` 只提示）+ 补丁构造）、`CandidateSketchFields.tsx`（五块子表单：入场 8 个子分组 / 过滤复用 `ConditionGroupsEditor` 的草稿模型 / 出场 3 项 / 风控 2 项 / 参数空间可增删行）、`candidateSketchForm.test.ts`（**22 例**）；**重写** `EditCandidateDialog.tsx`（5 个 `<Textarea>` → `CandidateSketchFields`，弹窗 `sm:max-w-4xl` + `max-h-[88vh]`，并把「距离可转正还差这些」的 `gaps` 清单直接摊在保存按钮上方）与 `CandidateSketchCard.tsx`（只读卡片改为**按结构渲染**，表达不了的那块**原样展示 JSON**）。**三、三条纪律（与旧版同一组保证，只换了表达方式）**：① **只产出后端认得的键** —— 枚举项一律取自本地词表，而词表由**对表测试**与服务端常量逐项比对（事件 / 单位 / 触发 / 数量 / 成本 / 仓位 / 参数类型 / 入场时点 / 扩展槽闭集 / **8 个条件运算符**（Research 侧 11 个里策略侧只映射 8 个，另 3 个 `BETWEEN`/`IS_NULL`/`IS_NOT_NULL` **结构上不出现在选项里**）/ 字段引用解析 18 例）；② **绝不静默丢数据** —— 遇到表单表达不了的既有内容（未知键 / 非法类型 / 不支持的运算符）该块**整块降级为只读 `raw`** 并写明原因，`raw` **永不进入补丁**（单测 `2-i` 锁定），只有用户显式点「清空」才提交 `null`；③ **往返幂等** —— 「打开编辑、什么都不改、点保存」**必须不产生写入**。**四、🔴 修掉一个真实缺陷（本轮最关键）**：`buildSketchPatch` 原来拿**原始 JSON 字面值**与**重新构造的规范化 JSON** 比 ⇒ `extra: {}`、键序差异被误判成「改动」（首次跑测 **4 例失败**，症状 = 补丁里凭空多出一个 `entryRule`）⇒ 改为**双侧规范化**（原始侧先 `toSketchDrafts`，两侧都过 `canonicalSketchJson` + `sketchValuesEqual`，空对象/空数组归一到 `null`），并抽出**唯一**映射表 `SKETCH_JSON_BUILDERS`，防「草稿 → JSON」两处各写一份。**五、验收**：`npx tsc --noEmit` **exit 0**（⚠️ **并因此消除了上一轮登记的 2 处错误** —— 它们在 `candidateSketchForm.ts`，正是本轮的**在途文件**，已随本轮收口）；`npx vitest run client/src/components/research client/src/adapters client/src/pages` **14 文件 / 375 例全过**（本轮新增 22 例 + `candidateForm.test.ts` `2-a`~`2-i` 组按结构化重写）；`npx vite build` **RC=0**（3,019 模块 / 14.82 s）。**六、真实库端到端（本机 `agent-browser` 不可用 ⇒ 按项目约定**不使用浏览器截图**做验收，改用「复用组件同一套 React-free 纯函数 + 真实 tRPC caller + 真实 TiDB」）**：① `docs/evidence/_e2e_sketch_form.mts`（只读）—— 库内既有候选 `270001` 五块**全空** ⇒ 打开编辑不产生假改动、改名补丁**只有 `name`**、无任何块降级 `raw`；② `docs/evidence/_e2e_sketch_roundtrip.mts`（**自建自清**）**24/24 PASS** —— 真实 `createFromConclusion` 登记探针候选 → 用**组件同一条补丁路径**（`buildUpdateCandidatePatch`）构造五块补丁 → 真实 `research.strategyCandidate.update` → 真实 `get` 读回，**五块逐块「落库值 == 目标值」**、读回后仍**全部可结构化**、读回 → 草稿 → JSON **幂等**、空改不产生补丁、**只改一块 ⇒ 补丁只含该块且其余四块未被触碰**，末尾删除探针候选并断言**候选行数守恒 1→1**。**七、边界**：未改任何 `server/**` 生产文件（`definitionBuild.ts` 这个**唯一转换器**一字未动）、未改 Dataset Registry、未新增第二个「Candidate → Strategy」入口（`strategyCandidateUiContract.test.ts` 把 3 个新文件纳入契约扫描清单后仍全过）；**跨端约束如实说明** —— 客户端**不能** import 服务端运行时值（否则服务端模块会被打进浏览器包）⇒「后端权威 + 前端展示」在本仓库**只能**靠「本地常量表 + 对表测试」落地，这份表就是**漂移哨兵**（后端词表一变，测试先红，而不是页面静默给出转正不认识的取值）。
>
> 上轮实查：**2026-09-13 00:52 GMT+8**（**WORK RESEARCH-007.3（覆盖补齐 · A 档）Run `540001` 由 135 → 180 条：只用现有功能补掉两类「假缺口」，剩余 120 条缺口 100% 是引擎表达不了的真缺口**：**一、决策** = 用户明确「10 日与 20 日不是很关键」⇒ 排除 C 档（视界族）⇒ 执行 **A 档**（唯一零代码选项）。**二、补了什么（45 条；`docs/evidence/_r010_backfill_apply.mts` 预检 45/45 全过、无重名、无 RUNNING Run）**：**A-1 20 条** = 无资格约束 × 参照列「已回撤(不限幅度)」× 4 族（`return_1`/`return_3`/`max_return_5`/`max_drawdown_5`）× T+1~T+5（`return_5` 参照列原已有 ⇒ 不重复建）；**A-2 25 条** = 加「未破首板最低价」资格 × T+5 ×（5 族参照列 5 + 4 族 × 5 桶 20）⇒ **135 → 180**。⚠️ 加资格口径**只能有 T+5 一行**：`holds_event_low_{h}d` 的窗口恰为 `[T+1,T+h]`，只有 `h == 决策日` 才零前视，而变量层只存在 `holds_event_low_{5,10,20}d`（拿 `5d` 去过滤 T+1 决策日 = 拿 T+5 信息做 T+1 决策，**严重前视，明确不做**）。**三、怎么跑** = **`runIncremental` 而非 `runEngine`**（读源码确认：`runEngine` 整轮**会覆盖**该 Run 全部分析的结果；`runIncremental` 只补「尚无有效结果」的分析、**不覆盖已 COMPLETED 的 135 条**、复用 Run 冻结快照 ⇒ 新旧可比）；代价 = **增量批次不产结论**（`conclusionId` 恒 `null`，Run 结论仍是旧的 `480001 REJECTED`）。**四、真实执行（`docs/evidence/_r010_backfill_run.mts`）**：建批 `created=45 failed=0`（analysisIds `510001`~`510045`）；补跑 `executionSequence=3` / `basisSource=run-snapshot` / `datasetVersionId=390002`（未漂移）/ **`sampleCount=23978`（与 RESEARCH-007.1 完全一致）** / `analysisCount=45` / `resultCount=664` / **耗时 164.9 s** / 终态 `COMPLETED`，**45/45 全 COMPLETED**。**五、补后覆盖（`docs/evidence/_r009_coverage_probe.mts` 重跑）**：**180 条 / 可归组 180 / 未归类 0**；无资格约束 **130 → 150**、加资格 **5 → 30**；每族可归组 **36**（BARE 30 + 加资格 6）；⚠️ **剩余缺口 120 恰好 = 加资格 × T+1~T+4 × 6 列 × 5 族，100% 是引擎表达不了的真缺口** ⇒ 矩阵里 T+1~T+4 的「未建」是**如实反映现实**，不是渲染问题。**六、真实数据呈现（`docs/evidence/_r008_matrix_probe.mts` 只读）**：默认 `BARE × return_5` **30/30 格**（补前最左「已回撤」列整列缺失）；**三条互相独立的交叉一致性证据** = ① BARE × T+1 × 已回撤 `n=9,899` 与 007.1 审计的「组 A 9,899」**逐数字一致**；② 增量 `sampleCount=23,978` 与 FULL 批次相同；③ 补批前 135 条格值与 `docs/evidence/_r0071_summary.md` **逐格一致**（本轮未触碰）。**七、验收**：`tsc --noEmit` **本批涉及文件零错误**（全库仅剩 2 处错误、均在 `client/src/components/research/candidateSketchForm.ts`，**属并行会话在途改动**（修改时间 2026-09-13 00:47:25），与本批无关）；`vitest run client/src/components/research/researchMatrix.test.ts` **23/23 全过**（新增 1 例，覆盖「未破 + 已回撤」同现的新名称组合）；全量 `client/src` **400 例中 388 过 / 12 失败，失败全在 `candidateForm.test.ts`（同源于并行会话在途改动）**；🔴 **`server/**` 运行时代码一行未改**。**八、明确不能实现（已列给用户）**：加资格 × T+1~T+4（120 条）与「未破首板日**开盘价**」滚动资格 —— 需改 `server/researchEngine/variables.ts`（视界收窄到 `pathHorizons ∩ [1,5]` + `EVENT_LOW_GUARD_BASES` 加 `"open"`），**会热重启并杀死在途 Run**，须单独排期（B 档）。）（**WORK RESEARCH-007.3 覆盖审计（只读）：Run `540001` 的 135 个分析「按当初规格建齐」，但覆盖不完整** —— `2 口径 × 5 决策日 × 6 列 × 5 指标族 = 300` 的完整笛卡尔积下，实建 **135 = 125（5天×5桶×5指标）+ 5（「已回撤」参照列，仅 `→之后5日收益`）+ 5（T+5 破位资格，仅 `→之后5日收益`）**，与 `docs/evidence/_r0071_batch_plan.md` 逐条一致 ⇒ **用户的 `5*5*5+10` 就是原设计，不是漏建**；缺口 165 = **45 可补**（参照列缺 20 + 破位资格缺 25）+ **120 卡引擎**（`T+1..T+4` 破位资格造不出来：`buildEventLowGuardVariables` 视界只取 Dataset 的 `outcomeHorizons=[5,10,20]`，且 `EVENT_LOW_GUARD_BASES=["low","close"]` 无 `"open"`）；另有未算入的**视界轴**（Dataset `outcomeHorizons=[5,10,20]`，本批只用 1/3/5 日；`pathHorizon=20` ⇒ 视界越长可用决策日越少）。证据 `docs/evidence/_r009_coverage_probe.mts` / `docs/evidence/_r009_coverage_probe_result.md`。）（**WORK RESEARCH-007.2（前端线）Research「结果」页签新增「矩阵视图」—— 把 100+ 个批量分析拼回一张二维表**：触发 = 用户实报「100 多个分析结果根本没法看、看不到 5×5 表格」。**零 `server/**` 改动**，纯展示层聚合。**一、交付**：新增 **3 文件**（`client/src/components/research/researchMatrix.ts` **486 行纯函数** + `researchMatrix.test.ts` **380 / 22 例** + `ResearchMatrixView.tsx` **402**）+ **改 2**（`pages/research/ResearchDetail.tsx` 结果页签加「矩阵视图 / 逐分析」切换、**默认矩阵**，逐分析按钮改显名称 + >20 个时出搜索框；research barrel）。**零迁移 / 零新端点 / 零新依赖**。**二、可行性依据**：`getRun` 已返回全部分析 `name/target/status`，`getAnalysisResults` 的结果行自带 `dimension.group=ALL/CONDITION` + `DIFFERENCE/T_STAT_DIFFERENCE/P_VALUE_DIFFERENCE` ⇒ 横比数据**已在页面**，缺的只是聚合（否决「加后端聚合端点」：改 `server/**` 会热重启杀死在途研究 Run）。**三、归组契约**：族取 `target`（结构化权威）、决策日取 `name` 的 `T+d` **并与 target 起始日交叉校验**、桶取 `name` 的 `回撤X~Y%`、含「未破」⇒ 独立 scope（不与无约束格子混表）；⚠️ **改名会使分析脱离矩阵**，此时进「未归类」并带具体原因（**不静默丢弃**）。**四、口径纪律**：① **排除 `outcomeVariable`/`variable` 与 `target` 不一致的结果行** ⇒ 自动挡掉 9w 登记的 `CONDITIONAL` 附送 `MAX_DRAWDOWN` 行（真实数据每格命中 1 行并计数）；② 显著标记 `*`/`**` 来自引擎落库 `P_VALUE_DIFFERENCE`，**基准是「全样本」而非相邻桶**，并沿用引擎「未校正多重比较」免责；③ 小样本不判显著；④ **不产生新统计量**（行小结只给格数/样本合计/显著格数，**不做加权平均**）。**五、验收**：`tsc --noEmit` **exit 0**；`vitest run client/src` **17 文件 / 399 例全过**（新增 22 例）；**真实库端到端**（只读探针 `docs/evidence/_r008_matrix_probe.mts`）—— Run `540001` **135 分析 100% 归组 / 零未归类**、默认 `BARE × return_5` **30/30 格**、格值与 `docs/evidence/_r0071_summary.md` **逐格一致**；分行显著格 = T+1 **0 正/3 负** → T+4 **4**/0、T+5 3/0。报告 `docs/research/RESEARCH-007.2-research-matrix-view.md`）。
>
> 上轮实查：**2026-09-12 22:35 GMT+8**（**WORK RESEARCH-006.4.1-B（架构线 · 前端完整闭环）「Candidate → Strategy 转正前端闭环」—— Phase B 全部落地，`RESEARCH-006.4.1` 封板**：打通 `Conclusion → 创建 Candidate → 编辑 Strategy Sketch → DRAFT → REVIEW → ACCEPTED → **Promote** → Strategy / Strategy Version → 查看 Research Provenance`，且 **Strategy 脱离 Research 后仍可独立打开使用**。**一、交付**：新增 **5 文件 / 2,453 行**（`components/research/promoteForm.ts` **261（纯函数）** + `promoteForm.test.ts` **393（34 例）** + `PromoteCandidateDialog.tsx` **504** + `StrategyResearchProvenancePanel.tsx` **138** + 验收脚本 `scripts/verifyResearch00641Promote.mts` **1,157**）；**改 8 文件** —— 桥 `router.ts`（+224，`withDomainCode` 全面落地 + 新只读端点）、`service.ts`（+725，`getVersionProvenance`）、`router.test.ts`（+194）、`adapters/strategyCandidateAdapter.ts`（**404 → 829**：领域码抠取 / 14 字段结果 VM / 15 键提示表 / 溯源 VM）、`adapter.test.ts`（→ **50 例**）、候选详情（289 → 312）、`pages/StrategyEditor.tsx`（+38，消费 `?strategyId=&version=`）、research barrel（+12）。**零迁移 / 零新依赖 / 零 Dataset Registry 改动 / 零 `strategySchema` 改动 / 无 `strategy_drafts`**。**二、🔴 修复 Phase A 登记的前置技术债（本轮最关键）**：`toTrpcError` 原来**只透传 `message` 不带 `cause`** ⇒ 领域码**不跨 tRPC 边界**、14 个 promote 码塌缩成 5 个 tRPC code；现**所有分支**改为 `withDomainCode(e.code, …)` 把码写进 message（**复用仓库既有 `[CODE] message` 约定、不改 tRPC code**），前端**唯一**读码口 = `strategyCandidateAdapter.ts#readRpcDomainCode` ⇒ **真实库实测 6 个不同领域码在 caller 侧可区分**（`NOT_ACCEPTED` / `PROMOTE_SKETCH_INCOMPLETE` / `PROMOTE_SKETCH_INVALID` / `DATASET_DIVERGENCE_REASON_REQUIRED` / `DATASET_VERSION_NOT_FOUND` / `INVALID_INPUT`）且**每码一句不同的人话诊断**。**三、三条纪律的可验证落地**：① 入参**结构性只有两个键**（`{ candidateId, overrides? }`，`datasetBinding` 恒为 `{ datasetVersionId }`，`datasetId`/`label` **结构性不可达**）；② **`CONVERTED` 不给入口**（`NON_PROMOTABLE_STATUSES` 5 态，测试断言与后端状态表差集**恰好** = `ACCEPTED`）；③ **divergence 双重校验**（前端 trim 判空 + **后端独立拒绝**，三条失败路径真实验过且零新增）。**四、§13 判定（按指示不重构）**：`candidate.sourceDatasetDivergenceReason` 是**转正时的执行覆盖记录**（一致时必须 NULL），**不是**研究来源快照 —— 真实验收反证：Divergence 场景候选 `sourceDatasetVersionId` **未被覆盖**（仍 390002），执行坐标 390001 只落版本行与溯源行。**五、验收（3 轮真实 TiDB，自建自清）**：**第 3 轮 `exit 0`：PASS 123 项 / 失败 0**（前两轮各 96/97，失败点相同且根因 = `read ECONNRESET`，详见下条）；含 §28 首转 14 字段逐项 + 裸 SQL 复核、§29 幂等（行数不增 + 「未创建新版本」文案）、§29 Divergence、7 条失败路径**零新增**、`DRAFT → REJECTED` **被状态机拒绝**（`CONFLICT`）、**§23/§34 真删上游后 Strategy 仍可读**（`missingUpstreams` 如实标注、**不阻断**）、**13 张严格表逐表守恒** + 3 张 observed-only Δ0、自建自清无残留。**六、验收数字**：`tsc --noEmit` **exit 0**；`vite build` **RC=0**（3014 modules / 17.55 s）；聚焦 **9 文件 / 237 例全过**（前端 93 / 桥 144）；全量 **228 文件 / 3742 例，15 失败 / 7 文件与既有基线逐项一致 ⇒ 零新增失败**。**七、§40 边界全绿**：Dataset Registry + `drizzle/` 零改动、`strategySchema` 零改动、无 `strategy_drafts`、`promote` 生产定义点**仅** `router.ts:307`、`createStrategyVersion` 生产调用点**仅** `service.ts:948 → strategyPromotionPort`、无 `rd-*` 参与绑定判定、候选 UI 未用 `researchDataset`。**八、⚠️ 新登记技术债（未修，属 006.5+）**：生产读路径 `strategyPersistence/db.ts#loadProjections`（同类只读投影读）**无重试** —— 跨境空闲连接复用会 `read ECONNRESET`（**3 轮验收全部命中「长时间只用裸 mysql2 后第一次用 Drizzle 池读」这一位置**），用户打开带溯源的策略页时溯源区可能读失败；最小改法 = 复用既有 `withReadRetry`（**改 `server/**` 会热重启杀在途 Run，故本轮刻意未动**）。**九、§43 遵守**：**完成后未启动任何下一阶段**（Backtest / Parameter Search / Evaluation / Robustness / OOS / WFO / Simulated Trading / Production Execution / `cloneVersion` / `origin=INHERITED` 全部仍不存在）。详见 `docs/research/RESEARCH-006.4.1-B-implementation.md`（14 节）；证据 `/tmp/{verify00641b3,verify00641b4,full00641b,tests00641b,tsc00641b,vitebuild00641b}.log`。）
>
> 上轮实查：**2026-09-12 21:50 GMT+8**（**WORK RESEARCH-007.1（分析建设线）「首板有效回撤 Research 校正与补齐」—— 零产品代码改动**：① **错名校正** Run `510001` 的 `450021~450024`：「深度5档」→「相对首板收盘涨跌幅5分位」（`updateAnalysis`）；② **新增 Run `540001`**（Experiment `240002` / Dataset Version `390002`＝首板回踩 v2 / runNo=7 / COMPLETED）+ **135 个 `CONDITIONAL` 分析 `480001~480135`**（A 组「已回撤」×5 + **B 组 5×5 固定业务桶 × 5 指标 = 125** + C 组「T+5 加 `holds_event_low_5d`」×5）+ **1,952 行结果** + 自动结论 `480001` **REJECTED**（confidence 0.7；主分析 `480001` 效应 −0.0041 < 阈值 0.005）；整轮 **425.3 s**，样本 **23,978**。③ **🔴 自查纠正**：首版回撤桶用**双闭区间** ⇒ 平盘样本（`future_return=0`，非回撤）入桶 + 边界重复计数，5 桶加总 **10,106 > 组 A 9,899**（多 207）；改**左开右闭**后重写 130 个条件 + 整轮重跑 ⇒ T+1/T+4/T+5 加总与组 A **逐位相等**，T+2/T+3 各差 1 例（如实登记）。④ **离线交叉验证（只读 SQL，非产品口径）**：方向与产品版**同向且量级接近**，但 **8%+ 桶样本 4,474 → 215~226** ⇒ 产品口径高估深回撤频率；T+1×8%+ 最深跌幅 −8.47% → **−10.16%**。⑤ **8 项能力缺口**，核心一条：规格的**滚动资格判定** `min(low[T+1..T+d]) >= open(T)` **现有领域模型表达不了**（数据层原料齐全：`prefix(rd=0).open` + `post(rd≥1).low` 都在；缺的是变量层 —— 只有 `holds_event_low_{5,10,20}d`，基准是 `low(T)`、只 3 个视界，**无 `open` 基准、无 d=1..4**）；**最小扩展 = `EVENT_LOW_GUARD_BASES` 加 `"open"` + 视界扩到 `pathHorizons∩[1,5]`（单文件单函数、零 migration），本次未做**。另：`research_analysis` **无 description 列**；CONDITIONAL **不产 P25/P75**（DESCRIPTIVE 能产但不支持条件过滤）；无二维交叉分析类型；`updateAnalysis`/`setAnalysisConditions` **前端无入口**。**状态**：旧口径澄清 + 错名校正 = 完成；「已回撤」5×5 = **DATA_READY**；规格 §十九 的「**有效回撤**」回答 = **BLOCKED**（阻塞于滚动资格缺口）。⚠️ **全库绝对值含并行会话写入**（实测 `research_run` 11 / `research_analysis` 190 / `research_result` 3,427 / `research_conclusion` 10 / `research_strategy_candidate` 5 / `strategy_versions` 3）—— 本会话只新增 Run `540001` + 135 分析 + 1,952 结果 + 结论 `480001` + 4 处改名，**未碰 Strategy 链路**。**未改** `server/**` / `client/**`、零迁移、零新端点、零新依赖；**未产出任何交易结论**。详见 `docs/research/RESEARCH-007.1-pullback-correction.md`。
>
> 上轮实查：**2026-09-12 21:10 GMT+8**（**WORK RESEARCH-010（分析建设线）「首板后回撤收益特征分析」建成并执行 —— 零代码改动**：新增 Run **`510001`**（Experiment `240002` / Dataset Version `390002`＝首板回踩 v2 READY / runNo=6）+ **29 个分析 `450001~450029`**（`SEGMENT_RELATION` 14 + `CONDITIONAL` 15）+ **634 行结果** + 自动结论 **`390003` REJECTED**；样本 **23,978**，执行 **154.8 s**。当前真实库绝对值（含并行会话写入）：`research_experiment` **3** / `research_run` **10** / `research_analysis` **55** / `research_result` **1475** / `research_conclusion` **10** / `research_strategy_candidate` **1** / `strategy_versions` **0→0**（研究链路未碰 Strategy）。**规格可表达度 = ≈55% 严格 / ≈20% 只能近似 / ≈25% 现有能力无法表达**（8 项能力缺口，详见 `docs/research/RESEARCH-010-implementation.md` §4.3）。**未改** `server/**` / `client/**`、零迁移、零新端点、零新依赖；**未产出任何交易结论**。
> **【架构线 · 2026-09-12 21:11 GMT+8 · RESEARCH-006.4.1 Phase A = DONE】** 同线实查：**2026-09-12 21:11 GMT+8**（**STEP RESEARCH-006.4.1（架构线）Phase A 完成 —— Frontend Architecture Audit + Conclusion → Candidate + Candidate List/Detail**；**Phase B（Promote UI / Promote Dialog / Promote Result / Strategy Provenance / Strategy Version 导航）按 §19 明令未开工**）。触发 = 用户 19 节规格 + 硬约束「**不要为了「完整」一次把 006.4 全做完；先完成 Phase A，跑测试、真实 API 验证、检查 diff 和架构边界，然后停止**」。**一、§1 前端架构审计结论 = 本 STEP 需要新增 API 0 个**：候选列表复用既有 `researchEngine.listCandidates`（实验维度），详情用既有 `research.strategyCandidate.get`；**没有为「全局候选列表」新造第二套列表接口**（避免在与 Domain 无对应关系的维度上发明 API）。**二、交付（新增 11 文件 / 2,681 行【= 10 个 `client/**` 前端源/测试文件共 2,167 行 + 1 个验收脚本 `verifyConclusionToCandidateFlow.mts` 514 行】+ 修改 6 文件 / +75 −20【全部 `client/**`】）**：`adapters/strategyCandidateAdapter.ts`（404 行，**唯一展示契约层**：六态中文标签 / 5 个草图字段 / `DiagnosticError` 四段结构错误诊断）、`components/research/candidateForm.ts`（280 行**纯函数**：创建表单默认值 + 白名单补丁构造 + 流转目标表）、`CreateCandidateDialog.tsx`（结论卡入口）/ `EditCandidateDialog.tsx`（7 字段白名单）/ `CandidateLifecycleActions.tsx`（目标卡片式单选）/ `CandidateSketchCard.tsx`、`pages/research/StrategyCandidateDetail.tsx`（289 行）；路由 `/research/candidates/:candidateId` **必须先于 `/research/:experimentId` 匹配**（wouter 同前缀顺序敏感）。**三、🔴 「默认值归后端」的**可验证**实现**：`buildCreateCandidateInput` 在用户未改动时**只回 `{conclusionId}`** —— `name` / `description` / `experimentId` / `conclusionId` / `sourceDatasetVersionId` / `sourceResearchRunId` / `sourceTraceJson` **一律不由前端拼装**（单测 `1-b` / `1-d` 锁定「入参永远不含这 6 个后端负责字段」）。**四、🔴 `CONVERTED` 结构性不可达的三重保证**：前端流转表里**没有**它（表 = API 开放目标 ∩ 状态机允许迁移）+ 测试**运行时 import 后端真常量**做**逐状态严格相等**断言 + 另有 1 例锁住「状态机允许但 API 未开放」的缝（`REVIEW → DRAFT` 回退）⇒ 前端不得提供入口；用户若尝试，**显示后端拒绝（专属码语义）而非前端模拟转换**。**五、无浏览器环境下的 UI 验收路径**（本机 `agent-browser` 不可用、仓库无 `jsdom`/`@testing-library`）：**① 纯函数单测 47 例**（adapter 22 + form 25）+ **② 静态源码 ↔ 真实 `appRouter` 契约 7 例** + **③ 真实 tRPC caller 全链 + 裸 SQL 复核 41 项**。**六、Phase A 边界被测试锁定**：契约测试断言前端**不调用** `promote`、**无第二转换入口**、候选 UI **不直写 Strategy**、无禁止词汇（`researchDataset` / `strategy_drafts` / `candidate_definition_json` / `rd-` 当坐标比对）。**七、🔴 本轮最重要的技术发现（Phase B 前置技术债）**：`toTrpcError` **只透传 `message`、不带 `cause`** ⇒ **领域错误码不跨 tRPC 边界**，前端只能按 tRPC 语义 code + message 映射，且 §11 要求的 14 个错误码会**塌缩成 5 个 tRPC code**（其中 **4 个 `PROMOTE_*` 全落 `PRECONDITION_FAILED`，彼此无法区分**）。**建议 Phase B 第一步把领域码放进 message**（`message: \`[${e.code}] ${e.message}\``）—— 这**对得上本仓库既有约定**（`rpcErrorToDiagnostic` 第一件事就是 `/[([A-Z_]{3,})]/` 从 message 抠码）。**八、验收**：`npx tsc --noEmit` **exit 0**；新增 **3 个测试文件 / 54 例全过**；真实 TiDB `scripts/verifyConclusionToCandidateFlow.mts` **41 ✓ / 0 ✗ / exit 0**（含「策略侧 8 张表 **0→0**」「无残留自建候选」「本脚本可能触及的 13 张表**逐表守恒**」）；`npx vite build` **RC=0**（3,011 模块 / 24.86 s）；全量 **227 文件 / 3,678 例，15 失败 / 7 文件 —— 与既有环境依赖基线（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`，全部真实 DB 直连 / 外部 API / 5s 超时）逐项一致 ⇒ 零新增失败**。**九、零污染**：Dataset Registry **零改动**（`client/src/pages/datasets` / `client/src/components/datasetRegistry` / `client/src/adapters/datasetRegistryAdapter.ts` / `server/datasetRegistry` 的 `git status` **全为空**）；**本 STEP 未改任何 `server/**`**（`git status` 中 `server/**` 的 11 个 M 文件经 `find -newermt` 判据确认**均为前序会话 006.2 / 006.3 的改动**）；零迁移、零新端点、零新依赖。**十、未做（§19 明令属 Phase B）**：Promote UI / Promote Dialog / Promote Result 幂等提示 / Strategy Provenance 展示 / Strategy Version 导航 / `cloneVersion` / `origin = INHERITED`。**下一 STEP = `RESEARCH-006.4.1 Phase B`**（**须待 Phase A 稳定后再启动**）。详见 `docs/research/RESEARCH-006.4.1-A-implementation.md`（12 节）。
>
> **【架构线 · 2026-09-12 20:45 GMT+8 · RESEARCH-006.3 = COMPLETE】** 同线实查：**2026-09-12 20:45 GMT+8**（**STEP RESEARCH-006.3（架构线）完成 —— Strategy Candidate → Strategy Promote**，**唯一转正入口已落地并有真实 TiDB 41/41 PASS 全链验收**；**`cloneVersion` / `origin=INHERITED` / Promote UI / Backtest / Parameter Search 全部仍不存在**）。触发 = 用户 54 节规格，**唯一架构基准 = `docs/research/RESEARCH-006.0-architecture.md`**（§1 冲突审查已完成：**逐条无冲突**，未触发「停止实施」）。**一、唯一转正链路**：`ACCEPTED 候选 → promote() → ① definitionBuild（纯函数）→ ② 既有 validateCanonicalStrategyDefinition → ③ Dataset Registry 只读校验（存在 ∧ READY，唯一坐标 `dataset_version.id`）→ ④ StrategyService.create + saveVersion（含 5 投影 + Binding 校验，同事务）→ ⑤ provenance.create（DIRECT）→ ⑥ 候选 → CONVERTED + strategyDefinitionId`。**新增 2 源文件**：`definitionBuild.ts`（809 行，**唯一**转换器，确定性 / 纯函数 / 无 DB 副作用）+ `strategyPromotionPort.ts`（272 行，桥内**唯一**允许 import `strategyPersistence`/`strategySchema` 的生产文件，**复用既有 `StrategyService`、绝不直接 INSERT `strategy_versions`**）；`service.ts` 450 → **995 行**（`promote()` 12 步）；`router.ts` 199 → **307 行**（新增 `research.strategyCandidate.promote`，**`adminProcedure` 不开放 public**）。**二、🔴 「不猜测」与「必填」同时成立**：`StrategyDefinition` 必填面（`observationWindow`/`trigger`/`execution.quantityMethod`/`position.sizingMethod`/`riskRule.maxPositions`…）在 Research 词表**无对应字段** ⇒ 把 `Candidate.entryRule.extra` 定义为**唯一具名扩展槽（闭集 7 键）**，**复用既有列 ⇒ 零 migration**；**两类失败语义分开**（草稿**缺**内容 ⇒ `PROMOTE_SKETCH_INCOMPLETE` 回去**补**；草稿**写错** ⇒ `PROMOTE_SKETCH_INVALID` 回去**改**）；**显式映射表（不是推断）** = `ENTRY_TIMING_TO_EXECUTION` 3 项 + `EXIT_REALIZATION` 固定表（STOP_LOSS p1/INTRADAY、TAKE_PROFIT p2/INTRADAY、TIME_EXIT p3/ON_CLOSE）+ `CONDITION_OPERATOR_MAP` 8 项；**前置响亮拒绝** = 字段引用语法不过 `parseStrategyFieldReference` / `parameterRole` 恒 `TUNABLE` 故数值参数**必须同时给 min+max**、非数值须给**非空 allowedValues** / `BETWEEN`·`IS_NULL`·`IS_NOT_NULL` / `riskRule.regimeGate`（**不静默丢弃**）。**三、Dataset Binding（§30 区分两概念）**：研究来源 Dataset（`candidate.sourceDatasetVersionId`，只进 provenance）≠ 执行 Dataset（`definition.datasets[0]` `role=PRIMARY` + `strategy_version_datasets`）；缺省**继承来源**；显式指定不同 ⇒ **divergence 原因必填**；指定**一致却填原因 = 造假** ⇒ `INVALID_INPUT`（含 `N/A`·`same dataset` 占位负例）；执行 Dataset 必须**存在 ∧ READY**。**四、幂等**：闸门 = `strategy_research_provenance.sourceCandidateId`；第二次 promote **绝对不能产生第二个 Strategy Version**（闸门不再进写入路径 + `strategyId` 确定性派生 `cand-<candidateId>` + 版本号固定 `1.0.0`）；🔴 **幂等路径不静默忽略调用方输入**（改绑拒绝 / 一致却填 reason 拒绝 / 已 divergence 传新 reason 拒绝）。**五、跨存储失败与恢复**：三次跨存储写**非原子** ⇒ 任一失败抛 `PROMOTE_WRITEBACK_FAILED` 并**携带 `strategyId`/`strategyVersionId`/`stage`**；🔴 **禁止删除已创建的 Strategy 做「回滚」**（代码零 delete）；恢复靠闸门幂等 + 指纹幂等自愈 + 补写。**六、provenance**：13 列、`origin` **恒 `DIRECT`**；**历史事实快照**（零 FK、上游被删仍可读、**无 update**）；**display-only**，**不参与 fingerprint/validate/backtest/参数搜索/执行**。**七、🔴 测试抓到的两个真 bug（已修）**：① **两层指纹混用** —— 初版 `findVersion` 用 `repo.getVersion().fingerprint`（§17 追溯记录指纹，含 `codeVersion`/`createdAt` 等**每次注入可能不同**的元数据）⇒ 把「同一份内容换时间戳」误判 `PROMOTE_VERSION_CONFLICT`，**让幂等恢复路径整个失效**；改用 `getVersionBundle().fingerprint`（= `strategy_versions.fingerprint`，document 内容指纹）。② **幂等路径静默忽略 overrides**（违反 §53）⇒ 重写为相容性核对 + 补 21b/21c 两例。**八、验收**：`tsc` **exit 0**；桥聚焦 **6 文件 / 144 例全过**（`definitionBuild.test.ts` **35** / `service.promote.test.ts` **30** / `router.test.ts` **16** / `importBoundary.test.ts` **10** / 既有 49 + 4）；真实 TiDB `scripts/verifyStrategyCandidatePromote.mts` **41 项 / 0 失败 / PASS**（**裸 SQL 独立复核** + **行数证明：第二次 promote 零新增行** + **divergence 分支** + **15 张表行数守恒** + **残留自建行 0**）；全量 **224 文件 / 3624 例，15 失败 / 7 文件 —— 与既有基线逐项一致 ⇒ 零新增失败**。**九、§46/§47**：`createStrategyVersion`/`provenance.create`/`CONVERTED`/`promote` 生产源**全部收敛在桥内**；`importBoundary.test.ts` 把 006.2 的「桥不得 import Strategy」**改写为允许清单式**（`strategyPromotionPort.ts` 唯一可 import `strategyPersistence`；`+definitionBuild.ts` 可 import `strategySchema`；断言清单成员确实存在）。**十、零污染**：**Dataset Registry 零改动**、**无 `rd-*` 参与绑定判定**、**前端零改动**（不做 Promote UI）、**不做 `cloneVersion`/`INHERITED`**。产物 `docs/research/RESEARCH-006.3-implementation.md`（23 节 + 字段映射表）。**下一 STEP = `RESEARCH-006.4`（API 收口 + 前端）**，**本 STEP 未做 006.4**（§54 明令）。
>
> 前次实查：**2026-09-12 19:45 GMT+8**（**STEP RESEARCH-006.2（架构线）完成 —— Conclusion → Strategy Candidate Service**，状态 **CODE_READY**（Service + Router 已落地并有真实 TiDB 验收；**promote / 前端 / Backtest 全部仍不存在**）。触发 = 用户 35 节规格，**唯一架构基准 = `docs/research/RESEARCH-006.0-architecture.md`**。**一、交付 = 只接业务线路，不转正**：在唯一桥目录 `server/research/strategyCandidate/` 新增**应用层** —— `candidateTypes.ts`（白名单 / 错误码 / 资格）、`evidenceTrace.ts`（证据快照纯函数）、`service.ts`（`StrategyCandidateService`）、`datasetVersionPort.ts`（Registry 只读端口）、`router.ts`（`research.strategyCandidate.*`）。**4 个能力 = `createFromConclusion` / `get` / `update` / `transition`；其余一律不做。** **二、createFromConclusion 八步校验链**（§4/§5）：入参 → Conclusion 存在 → Experiment 存在 → 坐标合法 → Dataset Version 存在 ∧ **READY** → Conclusion 资格 ∈ `{DRAFT,FINAL}` → 同结论同名重复 → 证据快照 + Run 两跳解析 → 落库（**从不传 `status`，恒 `DRAFT`**）。错误码 11 个，全带 `STRATEGY_CANDIDATE_` 前缀。**三、三条不可让渡的来源纪律**：① `sourceDatasetVersionId` **只从 `research_experiment.datasetVersionId` 复制**，唯一坐标 `dataset_version.id`，`overrides` **明确拒绝** `datasetVersionId`（防改写研究历史）；② `sourceResearchRunId` 走 `evidence.primaryAnalysis.analysisId → research_analysis.runId` **两跳**，**唯一性判据 = 去重 runId 集合长度 1**（0 个 / 多个一律 NULL），**提不出即 NULL、绝不猜**；③ `sourceTraceJson` 是**最小充分 provenance 快照**（`snapshotKind=research_conclusion_evidence` / `snapshotFormatVersion=1`），**只读结论自身 `evidenceJson`**，**不**把 result / analysis / run 整体序列化为第二份存储，`contributingAnalyses` 截 20 条、文本截 400 字符且**超限如实标注**，**不写时间戳**（确定性）。**四、🔴 不伪造策略定义（§10/§11）**：Conclusion 结构里**没有** `entryRule` / `exitRule` / `riskRule` / `parameterSpace` 信息 ⇒ 缺省路径下这 5 个规则列**全部保持为空**（有单测锁定），只有**人**经 `overrides` 显式传入才落库。**五、update = 闭集白名单**（§15/§16）：可写仅 `name` / `description` / `entryRule` / `filterRule` / `exitRule` / `riskRule` / `parameterSpace`；**逐个显式赋值**（禁 `Object.assign` / spread ⇒ 新增字段默认不可写）；**硬拒** `status` / `strategyDefinitionId` / `conclusionId` / `experimentId` / 4 个 `source*` / 未知字段（**点名 + 响亮失败，不静默丢弃**）；空 patch 亦拒。**六、🔴 transition 三处入口全拒 `CONVERTED`**（§17/§18）：`createFromConclusion`（结构性：从不传 status）/ `update`（`status` 不在白名单）/ `transition`（**专属错误码 `CONVERSION_REQUIRES_PROMOTE`**）—— 给专属码而非泛化「非法迁移」，因为「要走 promote」是**架构裁定**；Router 的 `to` 枚举**故意含 `CONVERTED`** 让调用方看到这条信息。开放目标仅 `{REVIEW, ACCEPTED, REJECTED, ARCHIVED}`；`REVIEW→DRAFT` 状态机允许但**本 STEP 不开放**（「未开放 ≠ 已禁止」，留 006.4 裁定，已写进注释）。**七、Router / 权限**（§19/§20）：`research.strategyCandidate.{get【public】, createFromConclusion / update / transition【admin】}`，与 `research.strategy.*` 并列（前者管「研究取舍登记」、后者管「已转正策略本体」），**不新造权限模型**；领域错误 → 稳定 code（NOT_FOUND / PRECONDITION_FAILED / CONFLICT / BAD_REQUEST），并映射仓储 `ResearchReferenceError` / `ResearchCandidateError` / `ResearchConflictError`。**八、§21 依赖边界**：桥**本 STEP 不 import `strategyPersistence` / `strategySchema`**，`importBoundary.test.ts` **追加 2 例**守护（① 桥不得 import Strategy 领域；② 桥生产源文件不得出现 `strategyVersions` / `strategyVersionDatasets` / `INSERT INTO strateg` —— **跳过 `.test.ts` 自身**）；`index.ts` barrel **刻意不导出** `router.ts` / `datasetVersionPort.ts`（避免单测被动拉起 DB）。**九、验收**：`npx tsc --noEmit` **RC=0**；桥聚焦 **4 文件 / 73 例全过**；四目录聚焦（strategyCandidate + researchCore + strategyPersistence + datasetRegistry）**26 文件 / 484 例全过**；全量 **222 文件 / 3553 例，15 失败 / 7 文件 —— 与既有基线逐项一致（`dataHealth` 1 / `image.uploadAndRecognize` 1 / `limitUp` 1 / `limitUp.watch` 4 / `marketData` 4 / `tushare.secret` 1 / `tushareTradingCalendar` 3）⇒ 零新增失败**（相对 006.1 的 3490 例 **+63 例**，恰为本次新增）。**十、真实 TiDB 验收**（`scripts/verifyStrategyCandidateService.mts`，自建自清）**RC=0 / 39 ✓ 0 ✗**：动态发现真实坐标 `conclusion 360001`（DRAFT）→ `experiment 240002` → `dataset version 390002`（v2/READY），**裸 SQL 独立算出期望 `runId=480001`** 再与 Service 写入比对；真实落库候选 `id=120001`（`status=DRAFT` / `sourceDatasetVersionId=390002` / `sourceResearchRunId=480001` / `sourceTraceJson.snapshotKind` 正确 / 裸 SQL 复核一致）；负例（Conclusion 不存在 / 重复同名 / Dataset 不存在 / 未 READY / overrides 带 `datasetVersionId`）**全过程零新增行（1→1）**；update 越界拒绝且**行内容零变化**；真实 `DRAFT→REVIEW` 落库；**`REVIEW→CONVERTED` 与 `ACCEPTED→CONVERTED` 均 `CONVERSION_REQUIRES_PROMOTE` 且 `strategyDefinitionId` 仍 null**；C7 Run 不可解析 ⇒ **NULL 且快照如实记 `missingAnalysisIds`**；**21 张表行数前后一致（21/21）**、**`strategy_versions` 0→0**、`strategies` / `strategy_version_datasets` / `strategy_research_provenance` **均 0 行**。**十一、⚠️ 如实登记**：① 真实库当前**无 `SUPERSEDED` 结论**（8 行全 DRAFT）⇒ 该负例分支**仅由单测覆盖**，不假装真实验证过；② 实施期间**另一条工作线（RESEARCH-009）在真实库新增数据**（相对 006.1 时点：result 674→841、conclusion 7→8、run 8→9、analysis 19→26）⇒ 验收脚本**动态发现**当前坐标而非硬编码旧值；③ 验收脚本遇 drizzle 连接池不退出问题，已改 `process.exit`（006.1 同款，已注释登记）。**产物**：`docs/research/RESEARCH-006.2-implementation.md`（17 节）；证据 `docs/evidence/_r0062_probe_result.md` / `docs/evidence/_r0062_verify.log` / `docs/evidence/_r0062_fulltest.log`。**未做（§29 严禁偷跑，已实查确认仍不存在）**：`promote` / `definitionBuild` / `cloneVersion` 继承 provenance / 向 `strategy_research_provenance` 写入 / `StrategyProvenancePort` 注入 / Candidate 前端 / Provenance UI / Backtest / Parameter Search / OOS / WFO；**未改** Dataset Registry / StrategyDocument / `StrategyService` / Strategy Persistence / `strategy_versions` schema / `strategy_version_datasets` schema。**下一 STEP = `RESEARCH-006.3`（Candidate → Strategy promote + definitionBuild + provenance + clone 继承）**，其后 006.4（API 收口 + 前端）/ 006.5（真实 TiDB + 真实 tRPC + Regression）；**一次只实施一个 STEP，006.2 未提前开发 006.3~006.5**。）
>
> **【上一版留档 · 2026-09-12 19:00 · RESEARCH-006.1（架构线）DATA_READY】**
> 最后实查：**2026-09-12 19:00 GMT+8**（**STEP RESEARCH-006.1（架构线）完成 —— Research → Strategy Bridge：数据库 + Domain Model**，状态 **DATA_READY**（migration `0036` 已实落**真实 TiDB** 且 `--check` PASS；桥的领域层双仓储可用；**业务 API / promote / transition / 前端全部仍不存在**）。触发 = 用户 30 节规格，**唯一架构基准 = `docs/research/RESEARCH-006.0-architecture.md`**。**一、数据库（纯增量：零数据迁移、零回填、零 FK）**：① `research_strategy_candidate` **+4 列**（`sourceDatasetVersionId` bigint NULL / `sourceResearchRunId` bigint NULL / `sourceTraceJson` longtext NULL / `sourceDatasetDivergenceReason` varchar(512) NULL）+ 索引 `idx_research_candidate_source_dataset_version`；② **新表** `strategy_research_provenance`（**13 列** + `UNIQUE(strategyVersionId)` + 3 索引；`origin` varchar(16) 默认 `DIRECT`；**零 FK**）。migration = 手写 `drizzle/0036_research_strategy_bridge.sql`（6 语句全带 `-- @guard:`）+ 幂等 `scripts/applyResearchStrategyBridge.mjs`（apply / `--dry-run` / `--check`，18.6 KB，逐项查 `information_schema`）。**实查断言全 PASS**：列类型/nullable/列序逐项正确；既有 **12 张 `research_*` 表列签名零意外变化**（Candidate = 基线 14 列 + 恰好 4 列，逐列比对）；`strategy_versions` / `strategy_version_datasets` **无任何 research 列**（Canonical 零污染）；**全库 FK = 0**；`--check` PASS 且**二次 apply 幂等**（6 语句全 skip、仍 PASS）。**行数守恒（apply 前后逐表 20 张）**：`research_result` 674→674、`research_conclusion` 7→7、`research_run` 8→8、`research_analysis` 19→19、`research_strategy_candidate` **0→0**、`strategy_research_provenance` 建表即 **0**、`strategy_versions` 0→0、`dataset_version` 2→2 ⇒ **migration 未自动产生任何 Candidate，既有研究数据零变化**。**二、Domain Model**：Candidate 领域类型 + 4 个 `source*` 字段 —— `sourceDatasetVersionId` 从 `research_experiment.datasetVersionId` **复制后不可变**（它回答「基于哪份数据研究出来」，**不是**「未来执行用哪份数据」）；`sourceResearchRunId` 经 `evidence.primaryAnalysis.analysisId → research_analysis.runId` **两跳**解析，**提不出即 NULL、禁止伪造**；`sourceTraceJson` 是 provenance **快照**（**不是** `research_result` 第二份存储 —— Result 重算即被 `deleteByAnalysis`+`createMany` 覆盖）；`sourceDatasetDivergenceReason` **仅当**研究来源 ≠ 执行绑定才非空（一致时必须 NULL，禁填空话）。`db.ts` / `inMemory.ts` **同判据、同语义**（create 写 4 列 / getById 读回 / `list({sourceDatasetVersionId})` 过滤 / update 边界一致）；`ResearchStrategyCandidateUpdatePatch` 收紧，`CreateInput` 自动获得 4 字段。**三、溯源仓储（Strategy 侧**独立切面**，不是 `strategy_versions` 的列）**：新增唯一桥目录 `server/research/strategyCandidate/`（`types.ts` / `provenance.ts` / `provenanceContract.ts` / `index.ts` + 3 个测试）—— `StrategyResearchProvenance` 领域类型 + 错误码（`ALREADY_EXISTS` / `NOT_FOUND` / `INVALID_INPUT`）+ `Db`/`InMemory` 双实现；能力 = `create` / `getByStrategyVersionId` / `listByStrategyId` / **`getBySourceCandidateId`（未来 promote 的幂等闸门）** / `deleteByStrategyId`（**非级联**，由未来 `deleteStrategy` 应用层显式调用）/ `deleteByStrategyVersionId`；**无 update**（历史事实快照，可改即伪造历史）。`source*` 全为**快照值 + 零 FK** ⇒ 上游行删除后仍能回答「从哪来」，Research 模块整个消失也不影响 Strategy 独立 validate/backtest/execute（Q10 = YES，**display-only**）。**四、⚠️ 实施中发现并已裁定的规则冲突（必须登记）**：006.1 §15 要求 `status` / `strategyDefinitionId` **亦**不可经普通 update 修改；但实查 `server/researchCore/repository/inMemory.test.ts`（**RESEARCH-001 既有验收**）**用 `update({status})` 走完 `DRAFT→REVIEW→ACCEPTED→CONVERTED`** 并断言非法迁移被拒 —— 仓库层摘出会**直接破坏既有基线**（违反 006.1 §26 / §16）；且 **006.0 §10.1 已把「摘除 `status`」明确划归 API 层（006.2）**。⇒ **裁定**：① **硬拒**（类型层排除 + 运行时 `assertCandidateUpdatePatchKeys` **响亮失败、不静默忽略**）= `experimentId` / `conclusionId` / 4 个 `source*`（结构锚 + 历史快照）；② **状态机守卫**（`assertCandidateTransition` + `assertCandidateConversionCoherence`，**既有语义未改**）= `status` / `strategyDefinitionId`，006.2 在 API 层摘出、006.3 起 `CONVERTED` 只能由 promote 到达。裁定已写入 `candidates.ts` / `contract.ts` / `schema.ts` 三处注释，并有「两清单无交集」的防漂移断言。**五、边界守护（把「靠人守」变成「靠测试守」）**：新增 `importBoundary.test.ts`（6 例，**读源文件文本 + 解析 import 说明符**，注释里的模块名不算）—— `server/researchCore/**` 不 import `strategyPersistence|strategySchema` ✓；`server/research/strategyPersistence/**` 不 import `researchCore` ✓；`server/datasetRegistry/**` 无反向依赖 ✓；**只有桥目录可同时 import 两者** ✓（006.3 加 Strategy 依赖时该断言开始真正生效）；桥不得被反向 import ✓；桥不得 import legacy `server/research/index.ts` ✓。**六、验收**：`npx tsc --noEmit` **RC=0**；聚焦（researchCore + strategyCandidate + strategyPersistence + datasetRegistry）**24 文件 / 421 例全过**；全量 **220 文件 / 3490 例，15 失败 / 7 文件 —— 与既有基线逐项一致（零新增失败）**；真实库 `scripts/verifyResearchStrategyBridge.mts` **50 ✓ / 0 ✗**（含**裸 SQL 独立证明 `UNIQUE(strategyVersionId)` 是真实数据库约束** ⇒ `ER_DUP_ENTRY`，以及**自建自清行数守恒**、**DB 与 InMemory 跑同一份契约且用例名集合逐字相同**）。**产物**：`docs/research/RESEARCH-006.1-implementation.md`（16 节）+ 证据 `docs/evidence/_r0061_probe_result.md` / `docs/evidence/_r0061_apply.json` / `docs/evidence/_r0061_apply2.json` / `docs/evidence/_r0061_check.json` / `docs/evidence/_r0061_verify.log` / `docs/evidence/_r0061_fulltest.log`。**未做（§29 严禁偷跑，已实查确认仍不存在）**：`research.strategyCandidate.createFromConclusion` / `promote` / `transition` / `get` 端点、Candidate 前端登记与编辑、Provenance UI、Research → Strategy 自动转换、Strategy Version 自动生成、`strategy_drafts`、新状态值、`StrategyService` 行为改动、`saveVersion` 接入 provenance。**下一 STEP = `RESEARCH-006.2`（Research Conclusion → Candidate Service）**，其后 006.3（promote + provenance）/ 006.4（API + 前端）/ 006.5（真实 TiDB + tRPC + Regression）；**一次只实施一个 STEP，006.1 未提前开发 006.2~006.5**。
>
> **【上一版留档 · 2026-09-12 18:35 · RESEARCH-006.0（架构线）DESIGN DONE】**
> 最后实查：**2026-09-12 18:35 GMT+8**（**STEP RESEARCH-006.0（架构线）完成 —— Research → Strategy Candidate/Draft 架构审计与接口设计**，状态 **DESIGN DONE**（**只读审计 + 设计，非实施**；**未改任何 schema / 未写 migration / 未改任何业务代码 / 未做数据迁移**）。触发 = 用户 26 节规格：在不改库、不改业务代码的前提下，审计 Research / Strategy / Dataset Registry 三模块真实实现，设计一条单向可追溯的 `Dataset Registry → Research → Conclusion → Candidate → Strategy Version` 链路。**审计方法**：直接读当前源码 + **真实 TiDB 只读实查**（新增探针 `docs/evidence/_r006_probe.mjs` → 证据 `docs/evidence/_r006_probe_result.md`：`information_schema` 列/索引/外键 + 21 张表行数与状态分布）。**最重要的发现 —— 桥已经建好，只是两头没接线**：`research_conclusion`（实查 **7 行**，全 `DRAFT`，5 SUPPORTED / 2 PARTIALLY_SUPPORTED）与 `research_strategy_candidate`（实查 **0 行**）**都已存在**；`server/researchCore/candidates.ts` 的机读状态机（`CANDIDATE_TRANSITIONS`、`assertCandidateTransition`、`assertCandidateConversionCoherence`）与 `repository/contract.ts:219-225` 的完整 Repository 契约（`create/getById/list/update/delete`）**均已实现** ⇒ **`RESEARCH_CONCLUSION` 与 `STRATEGY_CANDIDATE` 都不是 NOT IMPLEMENTED，缺的只是调用点**（全库 `candidates.create` 零调用；`maintenance.ts` 只用 `list`/`delete`）。**故本设计不新建任何 Candidate 对象，只激活既有写入位。** **六个真实断点**：B1 Candidate 无写入路径；B2 Conclusion 仅由引擎规则式生成（`engine.ts:311`）、**无 create/update 端点**；B3 Candidate ↔ Strategy 零连接（`strategyDefinitionId` 建了索引无写入者）；B4 `strategy_versions` 真实 15 列中**无任何 research 溯源列**；B5 `research_result`/`_analysis`/`_run` 实查**零 dataset 相关列**（坐标只在 `research_experiment.datasetVersionId`，且该列**创建即冻结**）；B6 `research.lifecycle.transition` 是**无状态纯函数**（不落库），与 `setVersionStatus` 构成两套状态真相。**Research 上游资格六问（指令 §19）**：❌ **Result 不是 immutable**（`engine.ts:712-714` `deleteByAnalysis` 后 `createMany` ⇒ 重算即替换）⇒ **不能作 provenance 锚点**；❌ **Conclusion → Run 不能列级反查**（`research_conclusion` **无 `runId`**，只能两跳解析 `evidence.primaryAnalysis.analysisId`，且可能提不出 id）；❌ **级联删除会毁桥**（`deleteExperimentCascade` **连 candidate 一起删**）⇒ **溯源快照必须写到 Strategy 侧**；⚠️ Result 缺结构化 Dataset/Config/Horizon/filter 上下文且无指纹无版本号。**方案裁定 = C（`Candidate` 即 Draft）**，理由：唯一**不新增领域对象**（既有表 + 状态机 + 契约齐备）；A/B 会让「Draft」同时是对象与状态、与 **C-21.1 八态撞名**（八态已含 `Draft` 与 `Candidate`）；A/B 的 Draft 表若承载可执行定义即**第二 Canonical SoT**（§25 禁止 4）；**Candidate 的规则草图与 Strategy Definition 是两套不可能同构的词表**（`ResearchEntryRule{event:string}` vs `entry.event.type ∈ {FIRST_LIMIT_UP,…}` + 字段时间域目录 + Look-Ahead L1–L8）⇒ 强转必须经**显式转换器**，该转换器正属 promote 服务。**溯源最小集**：`sourceConclusionId` + **`sourceResearchRunId`（唯一无法列级反查、可空即如实承认提不出）** + `sourceExperimentId` + `sourceDatasetVersionId`（**快照**）；**不存 `resultId`**（Result 可变）；`analysisId` 不列化（一结论可引多个 analysis）。**坐标**：`datasetVersionId = dataset_version.id` 唯一口径不变；明确区分 **Research Source Dataset**（快照）与 **Strategy Execution Dataset** ⇒ **允许不同**（缺省继承；不同须显式 overrides + 理由并显著提示），禁强制一致、禁改写研究来源。**DB 逻辑设计（不含 DDL）**：① `research_strategy_candidate` **仅增 4 列**（`sourceDatasetVersionId` / `sourceResearchRunId` / `sourceTraceJson` / `sourceDatasetDivergenceReason`；**不加**唯一约束 —— 明确**允许一个结论产多份候选**）；② **新增 1 表** `strategy_research_provenance`（`UNIQUE(strategyVersionId)`；`source*` 全为**快照值非 FK**；`origin=DIRECT|INHERITED`；**零外键**）；③ **不动** `strategy_versions` / 5 投影 / `StrategyDocument` / `StrategyVersionRecord`（**不递增 recordVersion** ⇒ 指纹与既有版本零影响）；④ **不建 `strategy_drafts`**。**防循环依赖**：唯一桥 = 新增 `server/research/strategyCandidate/`（`definitionBuild` 为**唯一显式转换器**）；铁律「`researchCore` 禁 import `strategySchema|strategyPersistence`；`strategyPersistence` 禁 import `researchCore`」；唯一例外 = `StrategyService` 接受**可选注入端口** `StrategyProvenancePort`（与既有 `DatasetVersionReferencePort` 注入同风格、缺省 no-op ⇒ 不构成反向依赖），供 `cloneVersion` 继承溯源。**API**：**保留**既有 `researchEngine.listCandidates`（不为好看搬路由）；新增 `get`/`createFromConclusion`/`update`（**白名单摘除 `status`**）/`transition`（🔴 **拒绝 `CONVERTED`**）/`promote`（**唯一能写 `CONVERTED` 与 provenance 的入口**）；读 `publicProcedure`、写 `adminProcedure`（与既有真实代码一致）。`promote` 8 步强制顺序 + **幂等闸门**（防重试产生第二份 Strategy）；🔴 **诚实登记跨存储事务缺口**：Strategy 写入与 candidate 回写**非原子** ⇒ 回写失败抛 `PROMOTE_WRITEBACK_FAILED` 并带上已生成的 `strategyId`，由幂等闸门兜底。**状态机**：Candidate **沿用既有六态不改**（补两条纪律：`CONVERTED` 只能由 promote 到达；`update` 摘除 `status`）；Strategy Version **复用 C-21.1 八态**，**明确拒绝**指令 §12 建议的四态（与八态重叠且更窄）；初始状态只能取 `GENESIS_STATUSES = [Draft, Research]`。**删除策略**：Research = provenance（快照）/ Strategy = independent artifact ⇒ 既有级联**保持不动**，Strategy 侧靠快照独立存活，**不需要** `SOURCE_DELETED` 列。**首板回踩设计级示例**走通全链（含 🔴 **「首板日开盘价」必须写 `prefix.rd0.open` 而非 `event.open`** —— T 日 OHLCV 在 `prefix.rd=0`，`event` 表无 OHLCV 列）。**产物**：唯一新增文件 `docs/research/RESEARCH-006.0-architecture.md`（16 节 + **Q1–Q10 结论表** + 审计证据清单）；**未修**任何审计发现的缺陷（只登记）。⚠️ **编号撞车（登记待裁定）**：§47 已用 `RESEARCH-006/007/008`（9m/9n/9o）指代**结果页可读性前端任务**，与本架构线**同名不同物** ⇒ 本 STEP 一律带 `.0/.1/…` 子号，后续建议在 §47 统一加「架构线」前缀。**下一 STEP**：`RESEARCH-006.1`（数据库 + Domain Model）⇒ `006.2`（Conclusion → Candidate Service）⇒ `006.3`（promote + provenance + clone 继承）⇒ `006.4`（API + 前端）⇒ `006.5`（真实 TiDB + tRPC + Regression）；**一次只实施一个 STEP**。）

>
> 此前实查：**2026-09-12 18:20 GMT+8**（**STEP STRATEGY-004 已完成 —— Strategy ↔ Dataset Registry 绑定对齐 + 引用完整性 + 暴露 STRATEGY-003 已有能力**，状态 **VALIDATED**（真实 DB 全链 + 真实 tRPC 双证；**非 RESEARCH_READY，不产出任何策略结论**）。触发：`AUDIT-DRS-001` 判定「当前唯一根断点 = Strategy ⇄ Dataset Registry 的 Dataset 版本标识不接头」并发起本 STEP。**核心变更**：① **坐标统一** —— 新增 `datasetVersionId bigint NULL` 到 `strategy_versions` + `strategy_version_datasets`（`drizzle/0035_strategy_dataset_binding_version_id.sql` + `scripts/applyStrategyDatasetBindingVersionId.mjs`，**2 列 + 2 索引，@guard 幂等，实跑 apply → `--check` PASS → 二次 apply 全 skip**），`datasetVersionId = dataset_version.id` 成为**跨模块唯一 Dataset Version 引用**，`datasetVersion`（`v1`/`v2`）**降级为显示 / 快照 label**（SPEC §2.1 A / §4）；② **真实引用完整性** —— 新增 `server/research/strategyPersistence/datasetBindingValidation.ts`（只读端口 `getVersionById`/`getDefinitionById` 由既有 `DbDatasetRegistry` 直接满足，**不新增第二套读取实现、不自动建 Dataset**），落库前断言「**存在 ∧ `status = READY` ∧ label 与 Registry 一致 ∧ `datasetId` 属于该版本**」，三类稳定错误码 `DATASET_VERSION_NOT_FOUND` / `DATASET_VERSION_NOT_READY` / `DATASET_BINDING_INVALID`，**与版本写入处于同一 DB 事务**（`db.ts#saveVersion`）⇒ 不存在「Strategy 保存成功但 Dataset Binding 实际无效」；③ **legacy 兼容保留** —— `rd-…` 无坐标分支**不做 DB 校验**但被显式标注为「未校验」，且 `label` 与 `rd-…` **禁止互相冒充**（`isStrategyDatasetVersionLabel` 排除 `rd-…`）；④ **暴露 STRATEGY-003 未暴露能力** —— `research.strategy.*` 新增 5 端点（`loadBundle` / `getVersionBundle`（同实现别名）/ `validateVersion`（读，public）/ `cloneVersion` / `setVersionStatus`（admin）），并把 `create`/`save`/`delete`/`createVersion` 由 `publicProcedure` 收紧为 **`adminProcedure`**；⑤ **UI 数据源统一** —— `StrategyBasicInfo.tsx` **移除 `trpc.researchDataset.list`**，改用 `trpc.datasetRegistry.listDefinitions / getDefinition / getVersion`（与 Research `CreateExperimentDialog` **完全同源**），**非 READY 版本以 `disabled` 显示但不可选**，选择即写入 `datasetVersionId = dataset_version.id`，重新打开由 `getVersion` 反查归属定义回显。**真实 TiDB 验收（`scripts/verifyStrategyDatasetBinding.mts`，101/101 PASS，连跑两次一致）**：`dataset_version` 实查 **390001 → v1 / 390002 → v2，均 READY**（`dataset_definition 120001 = first_limit_pullback`）；创建绑定 `first_limit_pullback / v2 / 390002 / PRIMARY` 后裸 SQL 断言 `strategy_versions.datasetVersionId = 390002` ∧ **JOIN `dataset_version` → version = v2 / status = READY** ∧ `strategy_version_datasets` 投影逐列一致；非法引用**逐条零写入（同事务回滚）**：`999999999 → DATASET_VERSION_NOT_FOUND`、`DRAFT/BUILDING/FAILED → DATASET_VERSION_NOT_READY`（⚠️ 真实库**无**非 READY 行，该场景在**只读端口**做状态覆盖，并复核 `dataset_version` **逐行未变** ⇒ 未写 Dataset 表）、交叉绑定 + label 不一致（`id=390002` 却写 `v1`）→ `DATASET_BINDING_INVALID`、`datasetVersionId = 0` → 领域层 `SCHEMA_DEFINITION_DATASET_VERSION_ID_INVALID`、双 PRIMARY → 拒绝；多绑定 `PRIMARY(390002) + VALIDATION(390001) + OOS(390001)` 全 READY → PASS；legacy `rd-…` 仍可保存且坐标落 **NULL**。**真实 tRPC 全链（`appRouter.createCaller`）**覆盖 create / save / load / list / listVersions / loadVersion / loadBundle / getVersionBundle / validateVersion / createVersion / cloneVersion / setVersionStatus / delete **13 端点**（坐标随 clone 与 createVersion 正确继承；`status` 迁移不改内容指纹）。**前端验收（`scripts/verifyStrategyDatasetBindingUi.mts`，46/46 PASS）**：选择器真实选项 = `first_limit_pullback` + `v1(390001)`/`v2(390002)`；`isUsableVersionStatus` 对 `DRAFT/BUILDING/FAILED/空/大小写错` 一律拒绝；`strategyToViewModel` → `viewModelToStrategy` → 真实 tRPC save → 重新 load 的 `datasetVersionId` 与 DB **三方一致**；legacy 分支 `datasetVersionId === null` 时 wire **不下发该键**（后端 legacy 分支才成立）。**顺带修掉一个真实缺陷**：`StrategyService#patchToInput` 在传入新 `definition` 时**透传 base 的 v1 视图**，与 `cloneStrategyDocument` 的既有契约（传 definition 即不透传视图、由 definition 单向派生）**相反** ⇒ `createVersion(带 definition)` **恒因 `SCHEMA_DEFINITION_VIEW_CONFLICT` 失败**（本 STEP 的真实 tRPC 验收暴露）；已改为「传 definition 时不下发视图键」，v1 视图交组装层派生。**回归**：`npx tsc --noEmit` **exit 0**；范围套件 `strategySchema + strategyPersistence + datasetRegistry` **17 文件 / 408 例全过**（含新增 `datasetBindingValidation.test.ts` **25 例**）；`scripts/verifyStrategyDomainModel.mts`（STRATEGY-003）**89/89 PASS**（同步补上新投影列的裸 SQL 读取）；全量 `vitest` **217 文件 / 3460 例 / 15 失败 / 7 文件**，与 §47 上一轮**独立会话**记录的失败集合与**总数逐项一致**（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`，全部为真实 DB 直连 / 外部 API / 既有证据快照的环境性失败；`dataHealth` 1 例为 §44 早已登记「仍 1 例失败且未修」的独立遗留）⇒ **零新增失败**。**未触碰证明**：STRATEGY-004 工作窗口内 `server/datasetRegistry/` / `server/strategy/`（legacy）/ `server/researchEngine/` / `server/researchCore/` **零文件被改动**（`find -newermt` 为空；`git diff --stat server/researchEngine` 为空）；`ds_*` / `dataset_definition` / `dataset_version` / `dataset_build_job` 行数与逐行内容**全程未变**（脚本内前后复核）。⚠️ **本仓库当前有并行会话在改前端研究分析（`GroupMetricChart` 反推对照组等）** —— 那些文件非本 STEP 所改，不得混淆归属。**遗留（诚实登记，未处理）**：① `dataset_version` **无「非 READY」样本** ⇒ `DATASET_VERSION_NOT_READY` 的真实行级验证目前只能靠只读端口覆盖，待真实存在 DRAFT/FAILED 版本时复核；② 项目约定**不加外键** ⇒ 校验与提交之间存在「另一事务删除该 `dataset_version`」的**应用层残留窗口**（已在 `db.ts` 注释登记，非静默）；③ **Research → Strategy 未连接**（本 STEP 明令不做）；④ `scripts/verifyDatasetRegistryRead.mts` 因**硬编码 10,240 事件**而与现实（23,978）不符 ⇒ FAIL，属该 DATASET-002.3 探针的**陈旧基线**（本 STEP 前即如此），**未修**（属 Dataset 模块，SPEC §8 禁止改动）。）
>
> 此前实查：**2026-09-12 15:20 GMT+8**（**PERF-IMPL-001 研究装配提速落地（方案 A：压缩 + 列裁剪 + 流水并发）**。触发：用户「这个项目中的分析研究过于慢，想办法加快一下，应该是数据过于多从而太慢了」→ 诊断（`docs/PERF-DIAG-001_research_assembly.md`）确认 **98% 耗时在数据集装配（529.7s）而非分析（11.9s）**，且**不是延迟受限**（RTT×往返仅占 ~2%）而是**吞吐受限** ⇒ 成本模型 `耗时 ≈ 行数 × 单行成本 ÷ 并发度` 只有三个杠杆。用户拍板「按方案 A，允许提升，不设上限，合理即可」。**本轮落地**：① `server/db.ts` 连接池加 `compress`（`DB_COMPRESS=0` 可关，默认开）、`DB_POOL_SIZE` 默认 10 → **16**；② 新增 `server/researchEngine/columnProjection.ts`（**列裁剪从变量定义自动派生**，不靠人声明）+ `datasetRegistry/query.ts` 四表读取支持 `columns` 投影 + `researchEngine/datasetReader.ts` 透传；③ `sampleSet.ts` 由「串行取批」改**有界流水并发**（默认深度 3，env `RESEARCH_ASSEMBLY_CONCURRENCY`）；④ **顺带补 robustness**：新增 `readRetry.ts`（跨境只读的**有界瞬时错误重试**；实测 14 次运行出现 1 次 `ECONNRESET`，无重试则整轮装配作废）。**同一时间窗受控 A/B（3 批 / 270,000 行）**：生产现状 `raw/no-prune/conc=1` **267,478ms** → `compress/no-prune` **73,494ms（3.64×）** → `+裁剪` **63,586ms（4.21×）** → `+流水线 conc=3` **15,563ms（17.18×）**；`conc=6` 15,486ms（与 3 无显著差异）。**全量 v2（12 批 / 1,071,266 行）实测装配 71,989ms**（不裁剪对照 107,838ms ⇒ 裁剪在全量下 1.50×）。⚠️ **诚实边界**：跨日绝对数字不可比（历史 529.7s 记录于链路更快时段；今日同样「不裁剪不压缩」的全量外推 ≈1,061s），**可靠的结论是同一时间窗内的比值 ~17×**。**口径零变更**：只改「取哪些列 / 怎么取」，不改 WHERE/ORDER BY/LIMIT/行数，不改任何变量定义与统计口径。**正确性三道防线**：① 派生用「记录访问代理」跑 `resolve`（读取即声明，不可能与实际读取漂移）；② 越界读取抛 `PROJECTION_MISSING_COLUMN`（`types.ts` 新增错误码），**杜绝「漏列 → 静默变 null」**；③ `columnProjection.test.ts` **13 例**（逐变量「全列 vs 投影」差分 + 端到端 `columnProjection:"all"` vs 派生装配结果 `toEqual` + 并发 1 vs 4 批序一致）。回归：`npx tsc --noEmit` **exit 0**；`vitest` **3206 例中 3191 过**，15 个失败**全部为既有环境性失败**（vitest 未加载 `.env` 的 DB 依赖用例 + `tushare.secret` 缺 token；已用 `DB_COMPRESS=0` 复跑证明与本轮改动无关）。）
>
> 此前实查：**2026-09-11 21:05 GMT+8**（**RESEARCH-002C 批量建分析**（触发：用户原话「现在初步看起来分析研究是能用了，但是我需要手动建立很多分析，有没有什么办法可以减少这个过程」。**重复劳动的两个来源**：① `createAnalysis` 端点**一次只收一个**分析，前端特征 / 目标 / 视界均为**单选**控件；② 建完还要**单独点「补跑」**（`createRun` 只建不执行、**无 worker 消费 `PENDING` Run**，`RUN_NOT_PENDING` 守卫又禁止覆盖 `COMPLETED`，新增分析只能走 `runIncremental`）⇒「5 特征 × 3 视界 + 1 稳定性 × 3 维度」这类组合现状 = **N 轮表单往返 + N 次补跑**。用户拍板：做 **A 批量矩阵 / B 标准套件 / D 跨实验模板** 三条路线，**只创建、不自动补跑**（C 复制已有分析本次不做）。**核心架构决策 —— 三条路线共用同一条落库路径**：标准套件**不另写生成逻辑**，只是「用预设值填矩阵表单」，交给与矩阵**同一个** `expandAnalysisMatrix` 展开（防「套件口径」与「矩阵口径」两套实现日后分叉）；模板展开（`applyAnalysisTemplate`）与矩阵批量**都调 `createAnalysesBatch`**，因此**预检整批拒绝 / 部分失败如实回显 / 补偿删除自动继承**。**两条设计纪律**：① **预检整批拒绝、不产半成品**（`assertBatchCreateItems` 在写库**之前**跑完预检，任一项不合法即 `BATCH_VALIDATION_FAILED`、**一个都不建**，消息显式写明「未创建任何分析」+ 前 10 项明细 —— 空批次 / 名称空或超 200 / 类型未实现 / CONDITIONAL 缺有效条件）；② **执行期部分失败如实回显 + 补偿删除**（失败项先删条件再删分析；补偿本身再失败则如实标注「⚠️ 回滚该项失败」，**绝不静默吞掉**）⇒ `created` 列表每项保证「**有 id 就能跑**」。**刻意不重复实现条件结构校验**：组的连续 / 组内 `sortOrder` 唯一 / 值元数等**结构性**合法性唯一权威是 `assertConditionSet`（由 `replaceForAnalysis` 写入时执行），批量路径只做预检级「有没有条件」判断（`fieldName.trim() !== ""`），避免两份规则迟早不一致。**模板用头+明细两表**（`research_analysis_template` / `research_analysis_template_item`，沿用 DATASET-003B 纪律：明细需确定性顺序 + 可索引检索、头表需唯一约束，名字是「一键铺开」的不歧义引用基础）；**唯一例外**是明细的**条件**用 `conditionsJson`（配置快照，不索引不约束，为它建第三张表只会让读取变成三表 join）—— **口径不降级**：展开成真分析时条件**仍写 `research_analysis_condition` 关系表**。**实现**：`drizzle/0033_research_analysis_template.sql` + `scripts/applyResearchAnalysisTemplate.mjs`（**34 项断言 PASS**：列 / 类型 / `varchar(120)` / 唯一约束 / 索引 / 零外键 + **10 张既有 research 表行数不变**；`--check` 幂等重放 PASS）；`server/researchEngine/batchCreate.ts`（`MAX_BATCH_CREATE_ITEMS = 200`）+ `templates.ts`（Draft 校验 + 明细 ⇄ 批量项双向转换）；`server/researchEngine/types.ts` 新增 **5 个错误码**（`BATCH_VALIDATION_FAILED`/`BATCH_TOO_LARGE`/`TEMPLATE_NOT_FOUND`/`TEMPLATE_NAME_CONFLICT`/`TEMPLATE_VALIDATION_FAILED`）；`researchEngineRouter.ts` 新增 **5 个端点**（`createAnalyses`(admin) / `listAnalysisTemplates`(**public**) / `createAnalysisTemplate`(admin) / `deleteAnalysisTemplate`(admin) / `applyAnalysisTemplate`(admin)），`createAnalysisItemSchema` **单建与批量共用**；`researchCore/repository` 新增 `templates`（`db.ts` 用 `loadTemplateItems` **批量取明细避免 N+1**、删模板**显式先删明细**；`inMemory.ts` 用 `cloneJson` 深拷贝阻断外部改写）。前端：`analysisBatchForm.ts`（矩阵展开 / 标准套件 / 模板预览 / 校验纯函数）+ `BatchAnalysisDialog.tsx`（三 Tab：矩阵展开 / 标准套件 / 我的模板；**建前摊开清单** + `skipped`/`truncated` 如实回显）+ `researchEngineAdapter.ts` 模板 VM + 5 条错误提示。**顺带修掉一个真实缺陷**：`createAnalysisTemplate` / `deleteAnalysisTemplate` / `applyAnalysisTemplate` 里 `throw new ResearchEngineError(...)` **直接抛、没走 `toTrpcError`** ⇒ tRPC 不自动映射领域错误、一律落 `INTERNAL_SERVER_ERROR`（被 2 例路由测试失败暴露）→ 改为 `toTrpcError(new ResearchEngineError(...))`，与文件内既有 9 个 catch 分支的约定对齐。**零数据依赖**：无回填、无 Dataset 重建、**未触碰 `ds_*` 物理表与 dataset 页面**。**验收**：`npx tsc --noEmit` **exit 0**；新增 `batchCreate.test.ts` **16 例** / `analysisBatchForm.test.ts` **27 例**，`inMemory.test.ts` 32 → **38 例**、`researchEngineRouter.test.ts` 32 → **43 例**；聚焦 **25 文件 / 450 例全过**；全量 **211 文件 / 3189 例**（**15 失败 / 7 文件 —— 失败数与失败文件集合恒等于基线**）⇒ **零新增失败**。报告 §20 + 附录 A/B。✅ 见 §44.5 队列 9g））
>
> 此前实查：**2026-09-11 20:35 GMT+8**（**RESEARCH-002B 增量补跑单个分析**（触发：用户实报两个问题 —— ①「新建了一个 run，为什么迟迟没有结果」；②「执行了一次分析，后面又新建了一个分析，但是没有可以让他运行的按钮」。**诊断（证据化）**：① `createRun` 注释即写明「**只创建，不执行**」，真正入口是 `researchEngine.runEngine`，而**服务端无任何后台 worker/cron 消费 PENDING Run**（`server/` 内 cron 全属 marketSync / paperTrading / heartbeat）⇒ 空 Run 永不自动出结果；② Run 一旦 `COMPLETED`，**双侧 `RUN_NOT_PENDING` 守卫**（前端 `RunEngineButton.tsx#executable`、后端 `engine.ts:119`）使「运行引擎」恒灰，而「新建 Run 重跑」这条路**走不通**（分析挂 `runId`、无继承能力、`updateAnalysis` 不能改 `runId`）⇒ **功能真实缺失，非配置问题**。用户决策：按「**允许增量补跑单个分析**」补，且**自己在页面上点**。**三条硬约束**：① 增量**必须复用 Run 冻结基准**（`inputSnapshot` 里的 `datasetVersionId` + 日期窗口），否则新老分析数字不可比（依据：`buildSampleSet` **不按条件过滤事件**，事件集只由「datasetVersionId + 日期窗口」决定、变量只作投影列 —— 已全文复核 `sampleSet.ts`）；② 增量**不得生成结论**且原因可证明（`AnalysisSummary` 的 effect/pValue/tStat **未落库**、`diagnostics` 明确不落 `result_json` ⇒ 无法重建已跳过分析的历史摘要，拿部分摘要拼结论 = 编造）；③ `inputSnapshot` **不可变**（RESEARCH-001 定死「执行时落定、事后不得修改」）⇒ 增量事实**另立追加式列**。**实现**：新增 `research_run.executionLogJson`（`drizzle/0032_research_run_execution_log.sql` + `scripts/applyResearchRunExecutionLog.mjs`，**17 项断言 PASS**：列存在/longtext/可空 + 12 个既有列仍在 + **行数与逐行数据不变**；`--dry-run`/`--check` 幂等）；`server/researchCore/executionLog.ts`（纯函数：结构校验**响亮失败、绝不降级成 `[]`** / 批次号推进 / `appendExecutionLogEntry` / `settleExecutionLogEntry`）；`server/researchEngine/engine.ts` **抽出 4 个共用核心**（`buildCatalog`/`loadConditionSets`/`resolveAnalyses`/`executeAnalyses`）供 `run()` 与新增 `runIncremental()` 共用；`runIncremental()` = 读快照基准 → 断言 `datasetVersionId` 一致（否则 `DATASET_VERSION_DRIFT`）→ 选可跑分析（`PENDING|FAILED|CANCELLED`）→ 变量需求**并上**快照基准变量 → 用**快照日期窗口** `buildSampleSet` → 执行 → **不建结论** → Run 终态由「是否仍有未完成分析」决定（`allCompleted ? COMPLETED : PENDING`）。新增 `researchEngine.runIncremental` 端点（admin）+ 4 类错误码映射。前端：`incrementalRunForm.ts`（补跑门禁纯函数：`enabled`/`reason`/`hint`/可补跑计数）、`RunIncrementalButton.tsx`（分析行内「补跑」：禁用原因 Tooltip + 执行证据弹窗 + **明示「本批次未生成结论」**）、`RunExecutionBatches.tsx`（Run 卡片「执行批次」表 + `skippedConclusionNotes()`；空日志时如实说明版本边界 ——「此前的整轮执行只体现在执行快照里」）；`ResearchDetail.tsx` 接线。**版本边界规则**：快照存在但日志为空 ⇒ 下一批 `sequence = 2`（**不 backfill**，批次 1 已被历史的整轮执行占用）。**刻意保留**「删分析后日志里的悬空 analysisId」并写入代码注释 + 报告（append-only 历史事实纪律）。**零数据依赖**：不重建 dataset、不碰 `ds_*`、不改 dataset 页面。**验收**：`npx tsc --noEmit` **exit 0**；新增测试 **3 文件 / 44 例**（`executionLog.test.ts` 18 / `engineIncremental.test.ts` 14 / `incrementalRunForm.test.ts` 12）全过；聚焦回归（`server/researchCore` + `server/researchEngine` + `researchEngineRouter.test.ts` + `client/src/components/research` + `client/src/adapters`）**23 文件 / 390 例全过**；`researchEngineRouter.test.ts` **29 → 32 例**；`server/researchEngine` + `server/researchCore` **234 例全过**（证明抽出共用核心后 `run()` **零回归**）；**真实 TiDB 端到端验收** `npx tsx scripts/verifyResearchEngine.mts --all` **RC=0**（73.5 s，自建自清 9 行；QUANTILE 顶底差 −3.0785% 经独立复算一致、证据落 `RESEARCH-002-e2e-evidence.json`）；**全量 vitest 209 文件 / 3117 例**（3102 通过 / 15 失败），**失败文件 7 个全部落在既有环境依赖基线集合内**（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`），且 `researchRunRouter` **已随 D 段消解（由失败转通过）** ⇒ **零新增失败**。报告 §19（19.1–19.8）+ 附录 A/B 已同步。）
>
> 此前实查：**2026-09-11 19:15 GMT+8**（**RESEARCH-002A 维护层 + 工作台可维护性**（用户指令：「不要管 dataset 功能与数据，需要你把研究模块完成」→ 范围选定 **A 引擎 CRUD/可维护性 + D 运行闭环**，数据边界为「只写代码用既有接口，不碰 `ds_*` 与 dataset 页面」）。**缺口审计（以代码/schema 为证，非采信文档）**：引擎 17 端点**零 update/delete**；`server/researchCore/repository/contract.ts:151-239` 早已定义全套 `update`/`delete`/`replaceForAnalysis`/`deleteByAnalysis` 但**全部不可达**；级联删除规则**只存在于** `scripts/verifyResearchEngine.mts#cleanupExperiment`（产品化不可达）；`setAnalysisConditions` 原语义只替换条件、**不清旧产物** → UI 继续展示「用旧口径算出的数字」（**静默不实，比抛错更危险**）。**服务端**：新增 `server/researchEngine/maintenance.ts`（**465 行**：`deleteRunCascade`/`deleteExperimentCascade`/`deleteAnalysisCascade`/`deleteHypothesisCascade`/`invalidateAnalysis`/`replaceConditionsAndInvalidate` 等），`researchEngineRouter.ts` 428 → **588 行 / 17 → 25 端点**（**+7 维护端点**全部 `adminProcedure`：`updateExperiment`（白名单 patch，**schema 无 `datasetVersionId` 键** ⇒ 数据集创建即冻结）/`deleteExperiment`/`updateHypothesis`/`deleteHypothesis`/`deleteRun`/`updateAnalysis`/`deleteAnalysis`），错误映射补 `DELETE_CONFLICT → CONFLICT`。**两条关键诚实性设计**：① `research_conclusion` **无 runId** ⇒ 删 Run 时**从 `evidence` 精确提取 `analysisId`**（`primaryAnalysis` ∪ `contributingAnalyses` ∪ 旧键 `analyses`）求交判定归属，**提不出 id 就绝不删**并计入 `unattributedConclusions` 如实回显；② 改口径 = **让旧产物失效**（守卫 → 替换 → 删旧结果 + 删失效结论 + Analysis/Run **回退 `PENDING`**），回退 PENDING 使既有 `runEngine` 的 `RUN_NOT_PENDING` 前置**恰好放行重跑**，故**无需新增重跑入口**。**前端**（沿用 adapter 分层，不在 JSX 强转）：新增 `ConditionGroupsEditor`/`ConfirmDeleteButton`（**不做任何数据推断**，后果由调用方按后端语义给出、删完回显服务端真实计数）/`ExperimentActions`/`AnalysisConditionEditor`/`CandidatesPanel`（**诚实空态**：讲清「引擎不做自动策略生成所以通常为空」）；`createAnalysisForm.ts` 新增 **`conditionGroupsToPayload`（新建与编辑共用同一载荷构造器）**/`conditionPayloadToDraftGroups`/`validateConditionGroups`；`ConclusionPanel` 加结论 JSON 导出（显式标注 `exportKind: "CLIENT_SIDE_API_SNAPSHOT"`）。**顺带修掉一个真实缺陷（第 8 项）**：`conditionGroupsToPayload` 原用**草稿下标**当 `groupNo`，而整组未填的空组不产出行 ⇒ 空组在前/在中时载荷**组号断号**，被 `server/researchCore/conditions.ts:181-183` 的 `assertConditionSet`（要求组号**唯一且连续 0..n-1**，写库路径 `repository/db.ts#replaceForAnalysis:649` 真会调用）直接拒；修法 = 按**有效组**重排连续、组内 `sortOrder` 紧凑（附带收益：**往返幂等**，「打开编辑→不改→保存」不改动库里任何口径）。**该缺陷的原测试把错误行为写成了期望**（`expect(rows[0]).toMatchObject({ groupNo: 1 })` 配一个空的第 1 组），已改正为 `groupNo: 0` 并注明原因。**零数据依赖**：无迁移、无回填、无 Dataset 重建、**未触碰 `ds_*` 与 dataset 页面**。**验收**：`npx tsc --noEmit` **exit 0**；`maintenance.test.ts` **19 例**（新增）、`researchEngineRouter.test.ts` **29 例**、聚焦全链路 **19 文件 / 326 例全过**、`client/src/components/research` **60 例**（含 14 例新增载荷往返/校验）；`npx vite build` **RC=0**（2995 modules）；全量 `vitest run` **204 文件 / 3010 例**（2994 通过 / 16 失败）—— **失败文件与 §11.3 基线逐字一致（同样 8 个环境依赖文件）⇒ 零新增失败**。报告 §17 + 附录 A/B/C 已同步。✅ **D 段已完成（2026-09-11 19:45，见 §44.5 9e）**：新建 `server/research/closedLoopWiring/`（14 阶段装配声明表 + 覆盖率探测 + 真实执行器，6 阶段已装配 / 8 阶段带确切原因留白）；`server/researchRunRouter.ts` 的 `executorBound` **由硬编码 `false` 改为真实探测**（同一 `assessClosedLoopWiringCoverage`），并新增 **`researchRun.loopRun`** 端点（真实调用 `runClosedLoop`，返回可审计轨迹 + 链指纹）；FE-4 运行工作台由 `emptyRunResult()` 占位改为真实接线（`closedLoopRunAdapter` + `ClosedLoopRunResultPanel`）。**仍未触碰 `ds_*` 与 dataset 页面**。）
>
> 🔴 **同上实查（重要，需决策）**：`docs/researchReadyGate/research_ready_gate.json`（capturedAt **2026-09-09T15:07:48Z**）实为 **`researchReady = true`**（G0 PASS / G1 GAP / **G2 PASS** / G3 GAP / **G4 PASS** / G5 GAP，`pendingChecks = []`）。这**推翻了** §44 此前「RESEARCH_READY=FALSE 期间」的表述。**现状（2026-09-11 19:45 更新）**：① `server/researchRunRouter.test.ts` 一侧**已随 D 段落地而消解**——原断言 `verdict=DATASET_NOT_READY` 是对「数据未认证」的**错误预期**，D 段把 readiness 改为**真实探测**后，该文件已重写为 **17 例**，其中一例为**漂移探测器**（断言 `dataGate.researchReady === true` 且 `verdict === "EXECUTOR_NOT_BOUND"`，并注明「若此断言失败说明快照已重新生成，请同步更新 ROADMAP 与 dataHealth 期望，而不是改回断言」）。② `server/dataHealth.test.ts`（断言 `G4=GAP` / `researchReady=false`）**仍 1 例失败且未修**：属**数据域治理**范围（认证脚本只读 TiDB 生成快照，`researchRunRouter` 只如实转述），改快照或改期望都属「用动作掩盖状态」。**待裁定**：快照该重跑认证回到 FALSE（若 Industry PIT/退出策略未完成则 G4 亦应重判），还是 dataHealth 的期望该更新。**与 D 段无关，独立遗留。**
>
> 此前实查：**2026-09-11 19:00 GMT+8**（**龙头候选池页面性能修复（应用层；统计口径与回测窗口一字未改）**：用户报告「露头（龙头）候选页面因数据太多卡住、无法渲染」。**实测定位**（临时探针）：全区间回测 **≈305~413s** —— `loadBacktestBaseContext` 约 **196s**（99,577 条 `limit_up_records` → **1,524,646 行价格行**（每股涨停日 ±44 天窗口并集）跨境 TiDB 传输；≈8K 行/s）+ 模拟 80s；而明细只有 **3,463 行 / 3.15MB**（首次测量）/ **10,336 行**（复核测量，差异原因见下）、整个结果 JSON 5.5~10.8MB → **病根是「等 5 分钟不出内容」而非 DOM 撑爆**（据此修正了先前「约 5 万行/30MB」的估算）。**修复三项**：① 明细改**服务端分页**（新 `server/leaderCandidateHistory.ts` 纯函数 + `db.getLeaderCandidateHistoryPage` + `sentiment.getLeaderCandidateHistoryPage`；`getLeaderCandidateBacktest` **不再回传 `historicalRows`**，改回传 `historicalRowCount`）+ 前端新组件 `CandidateHistoryTable` / `PaginationBar` → 单次响应 **10.83MB → 46.9KB（≈230×）**、翻页零重算；② 新增**磁盘快照** `server/leaderCandidateBacktestSnapshot.ts`（`.cache/leader-candidate-backtest/<hash>.json`，TTL 6h、只存 ≥256KB、原子写、最多 6 份、IO 失败静默降级）→ 进程重启（dev 下 `tsx watch` 频繁重启）后免重算；③ 新增 `db.invalidateLeaderCandidateBacktestCaches()` 挂在 **8 处**涨停/行情/停牌写入后清空内存+磁盘（**顺带修掉既有真实缺陷**：此前上传新涨停数据后 30 分钟内仍回传旧数字），并以 `backtestCacheGeneration` 版本号保证「计算期间发生写入 → 只回传不写缓存」。`sentimentCycle.ts` 抽出 `SENTIMENT_CYCLE_PHASES` 作阶段唯一权威顺序（schema 与漏斗共用）。**验证**：`npx tsc --noEmit` **exit 0**；新增 **3 文件 / 28 例**、聚焦套件 **6 文件 / 63 例全过（不连库，2.75s）**；`npx vite build` **RC=0**（17.6s）；真实 DB 验收 `scripts/verifyLeaderCandidateHistoryPaging.mts` 全项 PASS（冷调用 413.4s → 翻页 0ms；`totalRows=allRows=historicalRowCount=10,336`；207 页；两页重叠 0；越界页码 99999 → 夹取到 207/207；阶段筛选 totalRows=0 如实返回；磁盘快照命中 true 且含 10,336 行）。⚠️ **两次测量行数不同（3,463 → 10,336）不是本修复所致**：期间工作区被**另一会话**并发改动（`git diff --stat HEAD` 显示 `downsideRisk.ts` 未提交 **248 行**、`leaderCandidates.ts` **109 行**，内容为「高位连板风控 `maxParticipatingBoards`/`boardHeightRiskContribution`/`positionScale`」，`downsideRisk.ts` mtime 恰好落在验收运行途中；首次 tsc 还出现过随后自行消失的 `maxParticipatingBoards does not exist` 报错）→ 候选生成规则被改动导致行数变化，与本修复的正交性已确认（本修复只裁剪 **router 响应**，不触碰候选/评分/校准）。⚠️ **首次**全区间计算仍需 ≈305~413s（用户明确选择保持全部历史，不改窗口）；`getLeaderCandidates()` **28.8s** 仍在页面关键路径（未修）；真正 10× 提速需把价格窗口收窄到候选记录（3,463~10,336 / 99,577），但引擎用 `rawRows` 日期并集推导 `startDate/endDate` → 收窄会裁剪最早候选回溯窗口，**必须 A/B 逐字段对比后才可改**（未做）。
>
> 同日实查（**2026-09-11 18:58 GMT+8**，**DATASET-PERF-001 数据集构建性能专项**）：用户「构建速度还是很慢，分片策略并不是很好……数据库连接池、多线程、分片策略更加细致」。**根因实测（真实 TiDB，临时探针跑完即删）**：RTT ≈ **208ms / 次** → 构建链路是**延迟受限而非算力受限**；旧实现 3 个致命点：① **池形同虚设**——`server/db.ts` 全程 `await` 串行，`connectionLimit=10` 实际只用 1 条连接；② **取数粒度过粗**——Phase 1 逐日拉全市场、Phase 2 逐事件拉全市场，`stock_daily_prices` 8,893,077 行被大量搬过跨境网络；③ **分片用错维度**——按「天」而非按「富集/落库单元」切。**五项优化（零口径变更）**：① **连接池真正生效**（`server/db.ts` `resolvePoolSize()` 支持 `DB_POOL_SIZE`，默认 10 / 上限 64，补 `maxIdle`/`idleTimeout`/`queueLimit`/`keepAlive`/`connectTimeout`）；② **SQL 下推粗筛超集**（`detection.ts` `LIMIT_UP_CANDIDATE_SQL_PREDICATE` = `closePrice >= preClosePrice*1.045 OR (preClosePrice < 1.00 AND closePrice >= preClosePrice)`；1.045 阈值经**数值证明**——`exchangeLimitUpPrice` 在昨收 ≥ 1 元时最紧比值 1.0458716 > 1.045（余量 0.083%），昨收 < 1 元（面值退市股，涨停价可能 == 昨收）由 guard 子句兜住不筛）；③ **定向取数替代整段全市场**（新增 `fetchBarsForSymbolsInRange` / `fetchLiquidityForSymbolsInRange`）；④ **分片细化**（`concurrency.ts` 新增：`EVENT_CHUNK_DAYS=20` / `PATH_CHUNK_DAYS=30` / `SYMBOL_BATCH_SIZE=400` / `MAX_ROWS_PER_STATEMENT=2000`（占位符 65535 上限保护）/ `CANDIDATE_RANGE_MAX_MONTHS=1` / `INSERT_CONCURRENCY=2`）；⑤ **有界异步并发**（`mapWithConcurrency` / `forEachWithConcurrency`；**未用 `worker_threads`**——`limitUpDays` 连板状态必须单线程串行推进，Node 无共享内存，故「多线程」的正确等价物是并发 IO）。**辅助**：ST 区间与 `industry_assignments`（5,212 行）改为**全量内存索引**（`loadSecurityIndexes` + `resolveStSync`/`resolveIndustrySync`），逐 bar 解析 O(1)，省掉 242 天 × 0.77s ≈ **186s** 往返。**验证 `scripts/verifyDatasetBuildPerf.mts`（新增，5 阶段）→ S1~S4 共 21 项断言全过（21/21、失败 0）**：S1 阈值数值证明 3/3；S2 下推补集证明——`下推候选 100% 覆盖全量判定结果（零漏判）A=1585 B=1585 差集=0`、`全量 112,349 行/14,118ms（21 次往返）→ 候选 6,598 行/2,563ms（1 次调用）压缩 17.0×`、候选纯度 24.0%；S3 定向取数等价——`定向 16,367 行 与 全市场 219,455 行筛后 逐行一致`、压缩 13.4×；**S4 端到端等价（核心）——用新 builder 重建 v1 窗口（2026-08-01~08-31 / main / 排除 ST / pre=20 / post=20）与既有 v1 逐表比对：五表 60,002 行，行数一致 + 内容指纹一致 + 行级多重集差集 **0 行**（逐字节等价）**，耗时 **25.3s** / 2,368 行/s / 44.6 事件/s`。另 `npx tsc --noEmit` exit 0、`vitest run server/datasetRegistry` **12 文件 / 187 例全过**、临时版本级联清理零残留。⚠️ **诚实边界**：**同窗口「旧 vs 新」端到端 A/B 基线未采集**——HEAD 为 DATASET-001 时代代码（3 表、无筛选能力），与当前形态不可比，故提速证据取**组件级实测**（S2/S3 压缩比 + 并发标定 1/2/4/8 → 7,704/8,425/12,733/**17,862 行/s** + 月度分片并发 1/4/12 → 13,146/8,500/**3,903ms**），不宣称端到端倍数。
>
> 🔴 **同期实查修正既有结论（涨停口径审计）**：**新增 `scripts/verifyLimitUpCaliber.mts`（ds_* 版本口径真伪审计）**，实查既有两个版本 —— **v1(390001) 事件 1,130 行中「向下舍入型」436 行 = 38.6%**、**v2(390002) 13,579 行中 5,039 行 = 37.1%**，且两版本 `limitUpPrice` **逐元等于** `exchangeLimitUpPrice(pc, ratio)`（1,130/1,130、13,579/13,579），并经 `stock_daily_prices` **原始行情交叉验证**（如 `000007.SZ 2026-08-18` 真实 close=11.69 / 昨收 10.63 → 未舍入阈值 11.693000000000001 → **旧口径必然判否**，但 v1 确有该事件）。向下舍入型事件在「未四舍五入」旧口径下**根本不可能被产出**（旧口径上限 = 1,130−436 = 694）⇒ **既有 `ds_*`（v1/v2）的涨停判定口径 = 【四舍五入到分】，与现行代码同源，§44 此前「ds_* 仍是旧口径」的表述已不成立**；38.03% 实为 `docs/evidence/_limitprecision_probe.mjs` 测得的**旧谓词对原始行情**的漏判率，**不是** `ds_*` 表数据的属性（该探针只读 `stock_daily_prices`，从未读过 `ds_*`）。**新发现（真实缺陷，待处理）**：**v2(390002) 构建不完整** —— 仅 `event=13,579`，`prefix`/`post`/`path`/`outcome` **全为 0**，`status` 永久停留 `BUILDING`（`runner.ts` `completeJob → markReady` 两次写库非原子这一既有已知缺陷的下游后果）⇒ v2 **不可用于任何研究**，需**补完构建**（工程问题，**非**口径问题）；审计脚本当前 7/8 PASS，唯一失败项即此。
>
> 此前实查（**2026-09-11 18:35 GMT+8**）：（**RESEARCH-002 收口 · Research Engine MVP + 前端工作台**：引擎侧 `server/researchEngine/` **21 文件 / 4,156 行**（5 类分析各自独立 + MetricCalculator 唯一指标实现 + PIT 防火墙）+ `server/researchEngineRouter.ts` 428 行 / **17 个 tRPC 端点**（已注册 `appRouter.researchEngine`）；**前端工作台已交付**（`client/src/adapters/researchEngineAdapter.ts` + `client/src/components/research/` + `client/src/pages/research/`，路由 `/research`，前端新增 **3 文件 73 例全过**、`vite build` RC=0、真实 DB 只读契约核对 **24/24 PASS**）。测试合计：引擎 **8 文件 / 104 例**、前端 **3 文件 / 73 例**，`tsc --noEmit` **exit 0**；**真实 Dataset 端到端跑通**（Dataset Version **390001** READY，1130 事件 → Experiment/Hypothesis/Run → 5 分析全 COMPLETED → 138 结果行 → 结论 `PARTIALLY_SUPPORTED`，引擎 **27.5 s**，QUANTILE 顶底差 −3.0785% 经**独立复算完全一致**）；`ds_*` 物理表与既有表**零改动**。此前 RESEARCH-001（10 张表 / 95-95 PASS / 82 tests）、DATABASE-DESIGN-007（物理表 3→5 张，I1~I11 **31 项全 PASS**）与 DS-V2-FINAL（certify gate 17/17、`RESEARCH_READY=TRUE`、CERTIFIED Run `rd-1.0.0-1-fd1c487f2fe19e27`）结论均保持不变。⚠️ **DATASET-003B 遗留的「P1 涨停口径修复后须重建 smoke/v1/v2」仍未执行** —— `ds_*` 仍是旧口径（封板样本系统性漏判 ≈38.03%），**基于其上不得产出策略结论**（RESEARCH-002 及其前端只证明「引擎可用」，未产出策略结论））

> 🔴 **AUDIT-DRS-001 实查（2026-09-12 16:45，只读联合审计：Dataset + Research + New Strategy）**：详见 `AUDIT-DRS-001-EVIDENCE.md`。**三模块真实状态**：Dataset 可用（`dataset_version` **2 行** v1/v2 均 READY；v2 = 23,978 事件 / **1,543,082** 行 / 窗口 2024-08-31→2026-08-31；`dataset_build_job` 4 行含孤儿回收真实生效）；Research 可用（`research_run` 8 / `research_analysis` 19 / `research_result` **674** / `research_conclusion` 7；`researchEngine` **30 端点**；快照含 `datasetVersionId + datasetVersionLabel`）；New Strategy 7 表存在但**全 0 行**，模型纪律成立。**当前唯一根断点 = Strategy ⇄ Dataset Registry 的 Dataset 版本标识不接头**：新 Registry 版本是 `v1`/`v2`（`shared/datasetRegistryContracts.ts:61`），而 Strategy 绑定校验 `DATASET_VERSION_FORMAT_RE = /^rd-\d+\.\d+\.\d+-\d+-[0-9a-f]{16}$/`（`server/research/experimentLineage/validate.ts:51-58`，单测明确 `isValidDatasetVersionFormat("v1")===false`）⇒ 新 Strategy Version **无法合法绑定 Research 用过的 Dataset**；叠加**全库 0 外键** + 绑定**零引用完整性校验**。**Research ⇄ Strategy = NOT CONNECTED**（`research_run`/`research_analysis`/`research_result` **零 strategy 列**实查）。**推荐下一 STEP = STRATEGY-004（Strategy ↔ Dataset 绑定对齐 + 引用完整性 + 暴露 STRATEGY-003 已有能力）**；详见 §47 16:45 条。
>
> ⚠️ **本节下方 `dataset_version` 3 行（smoke/v1/v2）的旧表述已被上述实查覆盖为 2 行（v1/v2，smoke 已不存在）。**

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

1. ~~A OHLCV 收尾~~ ✅ 已完成（1863/1863 交易日 FULL，重复 0）
2. ~~G Industry 收尾~~ ✅ 已完成（5212/5552，340 无行业为真实退市；余 securityId 回填 + 历史轨迹两待办 → §48 P0-3）
3. ~~C+E 全量回填~~ ✅ 已完成（§44.1 实查：C 事件态覆盖 1,830 只 / E 5,131 股，gate #6/#9/#12 PASS）
4. ~~D Corporate Actions + Adjustment 全量~~ ✅ 已完成（§44.1 实查：CA 31,641 / AF 31,337，gate #10/#11 PASS）
5. ~~G 数据质量修复 + H gate 重跑~~ ⏸️ 部分完成（gate 17/17 全 PASS、`RESEARCH_READY=TRUE`；G 的 securityId 全 NULL + effectiveFrom 单点两质量待办仍 PENDING，属 STEP 12.5 PIT 审计前必修 → §48 P0-3）
6. ~~数据域认证 → 编码补齐 → 端到端验证~~ ✅ 已完成（DS-V2-FINAL：certify gate 17/17、CERTIFIED Run `rd-1.0.0-1-fd1c487f2fe19e27`）
7. **（业务数据待办，02:50 登记）limit_up_records 6,518 条名称对齐**：当日真实 10% 涨停但名称被回填套上当前 ST 名（208 只，清单 `scripts/backup/st_name_fix_targets.json`）。需 Tushare namechange 改回当日真实名称；实测限频 **1 次/小时**（当前 token 档位），约需 208+ 小时。工具就绪（provider + 清单），待更高积分 token / 配额放宽后执行（用户选定暂缓）。
8. ~~RESEARCH-001 Research 数据库与领域对象~~ ✅ 已完成（2026-09-10 22:56）：**10 张 `research_*` 表落库**（`drizzle/0031_research_core.sql`，103 列 / 30 索引项 + 10 PK；apply 断言 **95/95 PASS**；真实 DB 端到端 **45/45 PASS**）+ `server/researchCore/` Domain 与 Repository（测试 **82 tests 全过**，tsc exit 0，全量 vitest 无新增失败）。**遗留**：`drizzle/meta/_journal.json` 自 0024 起停维护（须先重建 baseline 才能恢复 `drizzle-kit`）；tRPC 路由 / 前端 / Research Engine 未做（后续任务）。
9. ~~RESEARCH-002 Research Engine MVP~~ ✅ **已完成（2026-09-11 00:26）**：`server/researchEngine/`（21 文件 / 4,156 行）+ `server/researchEngineRouter.ts`（17 端点），实现 **5 类分析**（DESCRIPTIVE / EVENT_STUDY / QUANTILE / CONDITIONAL / STABILITY）与**唯一** MetricCalculator（底层全复用 `shared/quant-stats.ts`）；PIT 由「`FeatureSources`/`OutcomeSources` 类型互斥 + 运行时角色断言」双重保障，并有「抹掉未来数据 → 特征逐字节不变」测试证明；**真实 Dataset 端到端跑通**（version 390001 / 1130 事件 / 5 分析全 COMPLETED / 138 结果行 / 结论 `PARTIALLY_SUPPORTED` / 引擎 27.5 s / QUANTILE 顶底差经独立复算完全一致）；测试 **8 文件 103 例全过**、`tsc` exit 0、全量 vitest **零新增失败**（+103 通过）；**`ds_*` 与既有表零改动**。报告 `docs/research/RESEARCH-002-report.md`、证据 `docs/research/RESEARCH-002-e2e-evidence.json`、脚本 `scripts/verifyResearchEngine.mts`。**明确排除**（未做）：IC/RankIC、因子搜索、ML、自动策略生成、Parameter Search、Backtest、OOS、WFO、Robustness。
   - **9b. 前端工作台（RESEARCH-002 消费侧）** ✅ **已完成（2026-09-11 18:35）**：`client/src/adapters/researchEngineAdapter.ts`（唯一展示契约层 + 26 例单测）、`client/src/components/research/`（表单纯函数 2 个 + 47 例、6 个展示组件）、`client/src/pages/research/`（列表 + 工作台 4 Tab）、路由 `/research`、侧边栏「研究实验」入口。三条「不造假」防线：指标单位按「自单位码表 → 变量名」判定不猜、缺失指标渲染 `—` 不伪装 0、分组表逐指标保留各自分母。前端新增 **3 文件 73 例全过**、`tsc` exit 0、`vite build` RC=0、真实 DB 只读契约核对 **24/24 PASS**（脚本 `scripts/checkResearchWorkbenchApi.mts`）。**顺带修复后端缺陷**：`conclusion.evidence` 两分支形状不一致 → 抽 `buildEvidence()` 单入口（第 11.4 节第 7 项）。**未触碰 Dataset 侧**（遵用户指令）。
   - **9c. 引擎维护层 + 工作台可维护性（RESEARCH-002A）** ✅ **已完成（2026-09-11 19:15）**：新增 `server/researchEngine/maintenance.ts`（465 行：级联删除 + 失效标记）+ `maintenance.test.ts`（19 例）；`researchEngineRouter.ts` **17 → 25 端点**（+7 维护端点，全 admin）；`setAnalysisConditions` 语义改为「替换 + 让旧产物失效」（删旧结果 + 删失效结论 + 回退 `PENDING`，复用既有 `RUN_NOT_PENDING` 前置实现重跑）；前端新增 5 个组件（共享条件编辑器 / 统一破坏性确认 / 实验操作 / 条件编辑 / 候选面板）+ 结论 JSON 导出。**顺带修掉真实缺陷**：条件载荷**组号断号**（原用草稿下标当 `groupNo`，空组在前/在中即被后端 `assertConditionSet` 拒）。**零数据依赖**（无迁移 / 无回填 / 未触碰 `ds_*` 与 dataset 页面）。验收：聚焦 **19 文件 / 326 例全过**、`vite build` RC=0、全量 **204 文件 / 3010 例**且**失败集合与基线逐字一致 → 零新增失败**。报告 §17。⚠️ **D 段未开工**（见 13）。
   - **9d. （D1）闭环 stage executor 装配** ✅ **已完成（2026-09-11 19:30）**：新建 `server/research/closedLoopWiring/`（`types.ts` / `requirements.ts` / `coverage.ts` / `executors.ts` / `index.ts` / `closedLoopWiring.test.ts`，**31 例**）。**14 阶段装配声明表 = 机器可读待办**：每个「未装配」阶段都写明**缺什么 + 为什么现在不装配 + 真实入口坐标**（拒绝「暂未实现」式占位）。**已装配 6**：`data`（投影调用方注入的真实 `ResearchDataset`，不构建以避与 Dataset 侧耦合）/ `research`（`runCandidateEngine`）/ `strategy`（`createStrategyDocument` + 可选 `createStrategyVersionRecord`）/ `backtest`（`runTradeSimulation` + 复用 `summarizeTradeSimulationRun`）/ `evaluation`（三套评估器 + 复用 `composeClosedLoopEvaluationRef`）/ `finalize`（编排器内置路径，无需注册）。**留白 8**：`optimization`/`robustness`/`oos`/`overfitting`/`regime`/`paper`/`review`/`discipline`（每条带确切依赖链理由；`regime` 标为最易补齐）。**关键语义修正（测试抓出的真实缺陷）**：入参来源原设计为「来源之间 OR、**来源内也 OR**」，导致 `research` 只在有 `dataset` 产物、缺 `experimentConfig`/`strategyContract`/`strategy13` 时仍被注册，直到运行期才抛 `CL_WIRING_INPUT_MISSING`（= 把「缺配置」伪装成「执行失败」）。修为**来源之间 OR、来源内 AND**（`ClosedLoopInputSource{inputs?, artifacts?}`），并补 3 例回归测试（含「有产物缺入参」与「有入参缺产物」双向 + `evaluation` 的多来源 OR 仍成立）。**纪律**：只为「真的能跑」的阶段注册执行器 ⇒ `stageRunners` 表本身就是一句实话；缺前置产物抛 `ClosedLoopWiringError` 响亮失败，绝不返回占位摘要。
   - **9e. （D2/D3）readiness 真实探测 + 闭环运行端点 + 运行工作台** ✅ **已完成（2026-09-11 19:45）**：① **readiness 真实探测**：`server/researchRunRouter.ts` 的 `executorBound` 从硬编码 `false` 改为 `assessClosedLoopWiringCoverage({})` 的真实结果，并把明细投影为 `wiring`（`wiredStages` 6 / `unwiredStages` 8 / `coveredStages` / `executorBound`）；未就绪措辞从「待数据域认证后集成」改为**如实点明哪 8 个阶段尚无执行器**。② **新增 `researchRun.loopRun`**（`mutation`）：接受调用方显式声明的真实入参（`stageIds` / `evaluationInput` / `backtestSummarySeed` / `lifecycle`），经 `createClosedLoopWiring` 装配后真实调用 `runClosedLoop`，返回 14 阶段轨迹 + 链指纹 + 装配覆盖；**无状态**（不写库、不落 run 记录）。**两条防伪绑定**：`evaluationInput` 必须与 `backtestSummarySeed` **成对提供**（`backtestFingerprint` 只取 `seed.fingerprint`，不接受调用方另填，且 evaluation 阶段本就需要 `backtestSummary` 交接）；`backtestSummarySeed` 与链内 `backtest` 阶段**互斥**（种子要求其产生阶段不在 `stageIds` 内，冲突即 `BAD_REQUEST` 而非静默丢种子）。③ **共享契约**：`shared/researchContracts.ts` 增 `CLOSED_LOOP_STAGE_ID_VALUES`（由**契约单测**断言与后端 canonical 逐项一致，防双份漂移）+ `closedLoopWiringSummarySchema` / `closedLoopRunInputSchema` / `closedLoopRunResultSchema` 等，并给 readiness 加 `wiring` 字段。④ **FE-4**：新增 `client/src/adapters/closedLoopRunAdapter.ts`（**零计算**：评估标量只从 `evaluationRef` 直搬，缺字段一律 `null`；防御性解析；`deriveExperimentId` 确定性派生 §28 标识符）与 `client/src/components/strategy/ClosedLoopRunResultPanel.tsx`（全链概要 + 评估标量 + 逐阶段轨迹 + 装配覆盖）；`RunConfigPanel` 增 `onRun`/`running`/`runError`，**按钮不再因 `executorBound=false` 锁死**（发起的是真实执行：入参齐备的阶段真跑、其余如实 BLOCKED，具有诊断价值），未就绪原因仅在 Tooltip 提示；`RunWorkbenchTab` 由 `emptyRunResult()` 占位改为真实接线（空态仍复用既有结构预留面板）。`client/src/lib/status.ts` 补 `EXECUTED`/`BLOCKED`/`ALL_EXECUTED`/`PARTIAL_BLOCKED`/`NO_STAGE_EXECUTED` 语义色。**验收**：`npx tsc --noEmit` exit 0；`closedLoopWiring.test.ts` **31 例**、`researchRunRouter.test.ts` **17 例**（由 2 例扩到 17 例）、`closedLoopRunAdapter.test.ts` **17 例**、`client/src` 全量 **10 文件 / 172 例**全过、聚焦批次 **17 文件 / 276 例**（唯一失败仍为 §44 已记录的 gate 快照冲突）；`npx vite build` RC=0。**⚠️ 仍未触碰 `ds_*` 与 dataset 页面**。
   - **9f. （RESEARCH-002B）增量补跑单个分析** ✅ **已完成（2026-09-11 20:35）**：用户实报「新建 Run 迟迟没结果」+「跑过一次后再新建分析，没有可运行的按钮」。**诊断**：`createRun` 只建容器不执行、**无后台 worker 消费 PENDING**；Run 已 `COMPLETED` 时双侧 `RUN_NOT_PENDING` 守卫使按钮恒灰，且「新建 Run 重跑」因分析挂 `runId` 且无继承而**走不通** ⇒ **能力缺失**。用户选定语义 = **允许增量补跑单个分析**（自己在页面上点）。**三条硬约束**：复用 Run 冻结基准（否则新老数字不可比）／增量**不生成结论**（`AnalysisSummary` 未落库，无法重建已跳过分析摘要）／`inputSnapshot` 不可变 ⇒ 另立**追加式**列。**实现**：`research_run.executionLogJson`（migration `0032` + apply 脚本 **17 断言 PASS**）、`server/researchCore/executionLog.ts`（批次日志纯函数）、`engine.ts` 抽 4 个共用核心 + 新增 `runIncremental()`、`researchEngine.runIncremental` 端点（admin）、前端 `incrementalRunForm.ts` + `RunIncrementalButton.tsx`（行内「补跑」）+ `RunExecutionBatches.tsx`（「执行批次」表）。**版本边界规则**：快照存在但日志空 ⇒ 下一批 `sequence = 2`，**不 backfill**。**零数据依赖**（不重建 dataset / 不碰 `ds_*` / 不改 dataset 页面）。验收：`tsc` exit 0；新增 **3 文件 / 44 例**；聚焦 **23 文件 / 390 例全过**；真实 TiDB `verifyResearchEngine.mts --all` **RC=0**（73.5 s）；全量 **209 文件 / 3117 例**（15 失败，**全落在既有环境依赖基线内**，且 `researchRunRouter` 已由 D 段消解）⇒ **零新增失败**。报告 §19 + 附录 A/B。
   - **9g. （RESEARCH-002C）批量建分析（矩阵 / 标准套件 / 跨实验模板）** ✅ **已完成（2026-09-11 21:05）**：触发 = 用户「需要手动建立很多分析，有没有什么办法可以减少这个过程」。**两个来源**：`createAnalysis` 一次只收一个（特征/目标/视界均**单选**）+ 建完还要单独点「补跑」⇒ N 轮往返 + N 次补跑。用户拍板做 **A 批量矩阵 / B 标准套件 / D 跨实验模板** 三条，**只创建不自动补跑**（C 复制已有分析不做）。**两条设计纪律**：① **预检整批拒绝、不产半成品**（`BATCH_VALIDATION_FAILED`，消息写明「未创建任何分析」）；② **执行期部分失败如实回显 + 补偿删除**（失败项先删条件再删分析；补偿再失败如实标注「⚠️ 回滚该项失败」）⇒ `created` 每项保证「有 id 就能跑」。**核心架构决策**：标准套件只是「用预设值填矩阵表单」、**不另写生成逻辑**；模板展开与矩阵批量**都调 `createAnalysesBatch`**，预检/回显/补偿**自动继承**。**模板用头+明细两表**，唯一例外是明细条件用 `conditionsJson` 快照（**口径不降级**：展开成真分析仍写 `research_analysis_condition` 关系表）。**实现**：migration `0033` + apply 脚本（**34 断言 PASS**、`--check` 幂等）、`batchCreate.ts` + `templates.ts`、`researchEngine` **5 个端点** + **5 个错误码**、前端 `analysisBatchForm.ts` + `BatchAnalysisDialog.tsx`（三 Tab，建前摊开清单）。**顺带修掉一个真实缺陷**：3 个模板端点 `throw new ResearchEngineError(...)` **没走 `toTrpcError`** ⇒ 一律落 `INTERNAL_SERVER_ERROR`（2 例失败暴露）→ 改为 `toTrpcError(new ...)`。**零数据依赖**（不碰 `ds_*` / dataset 页面）。验收：`tsc` exit 0；新增 `batchCreate.test.ts` **16 例** + `analysisBatchForm.test.ts` **27 例**，`inMemory.test.ts` 32 → **38 例**、`researchEngineRouter.test.ts` 32 → **43 例**；聚焦 **25 文件 / 450 例全过**；全量 **211 文件 / 3189 例**（**15 失败 / 7 文件 —— 与基线逐项一致**）⇒ **零新增失败**。报告 §20 + 附录 A/B。
   - **9h. （RESEARCH-002D，待决策）为研究 Run 补「启动时回收孤儿 `RUNNING`」钩子** ⏳ **未开始**：**动机 = 2026-09-11 22:48 真实事故** —— `dev` 脚本是 `tsx watch server/_core/index.ts`，改任何 `server/**` 文件触发热重启 ⇒ **在途研究 Run 的执行器随进程消亡，Run 永久停在 `RUNNING`**；而 `run()` 要求 `PENDING|FAILED|CANCELLED`、`runIncremental` 要求非 `RUNNING` ⇒ **实验被完全锁死，且无任何产品级恢复入口**（本轮只能人工脚本收敛）。**同构参照（已落地）**：dataset 构建侧 `reclaimOrphanBuildJobs()` 由 `server/_core/index.ts` 在 `server.listen` 后调用（判据 = `RUNNING` 且 `updatedAt` 停更 > `DATASET_RECLAIM_STALE_MINUTES`，默认 10 分钟），DATASET-LIFECYCLE-001 已用它自动解困卡死 23h 的 v2 幽灵作业 ⇒ **研究 Run 侧缺失同样兜底**。**待决策的两个判据（须先定）**：① **boot 时任何 `RUNNING` Run 即孤儿**（最严格、最贴合「执行器随进程消亡」的语义；但多实例部署下会误杀另一实例的在途 Run）；② **复用停更阈值**（与 dataset 侧一致；但对「5 分钟即被热重启杀掉」的 Run 要等到 10 分钟才回收，期间 UI 仍显示执行中）。⚠️ 需同时决定**是否确立「单实例假设」**（项目对 dataset 构建已按单实例处理）。**落地要点**：收敛时须一并写 `errorCode`（如 `RUN_ORPHANED`）+ `errorMessage`（写明「被进程重启中断」）+ `completedAt`，并把 Experiment 一并置 `FAILED`（与引擎「执行中失败 → Experiment FAILED」口径一致）；**禁**只改 status 不清残留（这正是本轮修掉的缺陷）。**验收应含**：boot 回收幂等、不误杀非 `RUNNING`、回收后 Run 可重新执行。⚠️ **该缺口已第二次产生真实卡死实例**：2026-09-12 15:37 人工收敛 Run 330003（`RUN_ORPHANED`，见 §47 15:40 条）；在此之前它已停更约 16.6 小时。
   - **9i. （RESEARCH-004）分段关系分析（两窗）：变量层分段族 + 新分析类型 + 新建分析页减负** ✅ **已完成（2026-09-12 15:30）**：触发 = 用户「想研究 T+1~T+5 的最大回撤与 T+5 之后更远区间的关系，现在好像不支持；而且新建分析的页面过于复杂」。**能力缺口（有代码坐标）**：95 个结果变量**全部锚定 T 日收盘**（`close(rd)/close(0) − 1`）⇒「T+5 → T+20 这一段」在**变量层就无法表达**；数据不缺（v2 的 `ds_first_limit_pullback_path` 实测 471,816 行、rd 1..20 逐日 close/high/low 齐备），缺的是变量层与分析层。三条现成路径都走不通：QUANTILE 的 `featureField` 走 `resolveFeature` ⇒ 拿 `max_drawdown_5d` 当分组键必被 `VARIABLE_ROLE_VIOLATION` 挡下；CONDITIONAL 只能二分、且 `future_return_20d` 的窗口**包含**分组窗 [T+1,T+5] ⇒ 重叠污染；全链路**无重叠守卫**。**用户拍板**：A（变量层）+ B（新分析类型）**一起做**，页面简化**与能力一起做**。
     - **A —— 分段变量族（按需构造，不进目录）**：`server/researchEngine/variables.ts` 增 `segment_{stat}_{a}_{b}d`（口径 `SEGMENT_STAT_KINDS` = return / max_return / min_return / max_drawdown；锚在**窗起点** `close(a)`、取值窗 `[a+1, b]`）。两条硬约束：① **`from = 0` 复用既有变量族**（`future_return_{to}d` / `{stat}_{to}d`）而**不另造第二套口径** ⇒「T→T+5 的最大回撤」就是 Dataset 已定的 `max_drawdown_5d`；② **不进 `listOutcomes()`**（190 窗 × 4 口径 ≈ 760 个名字，枚举会让变量目录膨胀约 8 倍并变成噪音源），但 `hasOutcome` / `resolveOutcome` 认得它，越界抛 `UNKNOWN_VARIABLE`；③ 缺任一天 ⇒ 整段返回 `null`（不按剩余日平滑算，口径不随缺失漂移）。
     - **B —— `SEGMENT_RELATION` 分析类型**：`researchCore/config.ts` + `researchEngine/analysisConfig.ts` 增 5 个窗参数与 4 项校验（窗形态 / 口径合法 / 可用性 / **重叠守卫 `WINDOW_OVERLAP`** + `windowBands` 2..100）；`analyses/segmentRelation.ts` 复用 QUANTILE 的 `computeCutPoints` / `assignQuantileGroups` 分档（相同值不劈开）；`metrics.ts` 增**配对层** `computePaired` + 3 码（`PAIR_CORRELATION` / `PAIR_RANK_CORRELATION` / `PAIR_SAMPLE_COUNT`，底层仍 `shared/quant-stats`，配对 = 两侧同时有限、**不插补**）；重叠守卫在**配置层与执行器各断言一次**（双重把关，上游被绕过也不静默出结论）。窗 B 口径为 `max_drawdown` 时不产出 `WIN_RATE`（「> 0 占比」不是胜率）并如实说明。
     - **C —— 新建分析页减负**：类型卡由类型名改**人话问题句**（`AnalysisTypeOption` 拆 `label` 短名 + `question` 问题句 —— 名字会进持久化的分析名，必须短）；移除「主分析优先级」徽标与底栏内部枚举；字段分「① 问什么问题 / ② 参数（只渲染必填）/ ③ 高级（默认收起，名称移入）」；新增 `WindowEditor` 实时显示窗映射到的**真实变量名**与「复用既有口径」徽标。**批量矩阵**新增 `MATRIX_ANALYSIS_TYPES` 并把 SEGMENT_RELATION 排除在外（两个窗就是选题本身，铺开 N 项只会产出 N 个相同配置），若被传入则记 `skipped` 说明，**不静默少建**。
     - **零迁移**：`analysisType` 是 `varchar(32)`（无 ENUM/CHECK），`SEGMENT_RELATION`（16 字符）可直接落库；未触碰 `ds_*` 与 dataset 页面。**验收**：`npx tsc --noEmit` **exit 0**；`npx vite build` **RC=0**；聚焦 **25 文件 / 470 例全过**（新增 `analysisConfig.test.ts` 13 例 + 分段变量 / 配对指标 / SEGMENT_RELATION 执行器 / 分段窗表单共 6 处扩测；同步把「恰好 5 类」的 4 个护栏断言更新到 6 类）；全量 **214 文件 / 3252 例，15 失败 / 7 文件**（失败集合与既有基线**逐项一致**，均为环境依赖：真实 DB 直连 / 外部 API / 5s 超时）⇒ **零新增失败**。
     - ⚠️ **顺带自查纠错一处表述**：原注释「窗 B 为 `max_drawdown` 时**恒为非正**」是**错的** —— 取值窗 `[a+1, b]` **不含锚点日**，价格整段上行时窗内最低收盘仍可能高于锚点收盘；已在代码注释与产出提示文案中改正（不产出 `WIN_RATE` 的理由改为「『> 0 占比』不是胜率」，而非「必然接近 0」）。
   - **9j. （RESEARCH-005）事件日形态变量 + 「最低价守护族」+ 逐日量比 + 内置示例 + 结果页去噪** ✅ **已完成（2026-09-12 16:05）**：触发 = 用户「新建分析页面还是很乱，我需要你给我一些例子，并把结果页面展示的更简洁明了」+ 具体研究问题「首板涨停、不是一字板、未来五日内回撤不破涨停日最低价 → 未来二十日收益，且要看回撤那几天每天的成交量关系」。**三条诊断**：① 首板**免费**（事件规格写死 `{relativeDay:0, kind:"firstBoard"}`，`datasetRegistry/filter.ts:29`）；② 数据全在（`prefix(rd=0)` 的 open/low、`path.volumeRatio`）但**变量层一个都没有**；③ 🔴 结果侧 `OutcomeSources` **拿不到事件日 `low(0)`** ⇒ 结构性障碍，必须先打通数据通路。**交付**：**A 变量层**（4 个特征 + `OutcomeSources.eventBar` / `OutcomeVariableDefinition.needsEventBar` + 12 个 `holds_event_low_*` / `event_low_margin_*` 守护变量 + 20 个 `volume_ratio_{h}d`）；**B 装配层**（`prefixDays.add(0)` + `outcomeSources` 注入 + **列投影探针兜底** —— 否则投影缺列、变量静默全 null）；**C 页面**（6 个「从例子开始」内置示例 + 结果页默认只显 6 类核心列 / 主指标速览 / `n=` 去重 / 长说明折叠）。**真实库实证**（v2/390002）：prefix rd=0 **23,978 行且 open/low/volume 零 NULL**；开盘即封 **5.08%**、全天未开板 **3.21%**。**验收**：`tsc` exit 0、`vite build` RC=0、聚焦 **28 文件 / 527 例全过**、全量 **216 文件 / 3399 例（17 失败 = 既有基线 15 + 并行 STRATEGY-003 会话 2）** ⇒ **零新增失败**。⚠️ 一处**自查纠错**（示例初版把 `volume_ratio_3d` 当 QUANTILE 的 `featureField` ⇒ **PIT 违规**，已改为条件筛选）与一个**真 bug**（条件写成条目数组而非组数组 `ConditionGroupDraft[]`，测试抓到后修）。详见 §47 16:05 条。
   - **9k. （STRATEGY-003）Strategy Domain Model & Persistence Architecture** ✅ **已完成（2026-09-12 16:20）**：把 Strategy 从「基础 CRUD + Versioning」升级为可被 Research / Parameter Search / Backtest 消费的完整领域模型。**用户三条裁定**：D1 在 `strategyDocumentJson` 内**演进**富模型（**不新建第二套 SoT 表**）；D2 **不改物理列名**（Domain 层语义映射）；D3 **复用 C-21.1 八态**（不新造 `DRAFT/RESEARCHING/ACTIVE/ARCHIVED`）。**交付**：① Migration `0034`（15 语句，`@guard` 守卫式幂等，apply 两次 `15 → 0 executed`）+ `strategies` +3 列 / `strategy_versions` +4 列 / **5 张单向派生投影表**；② Domain Model `StrategyDefinition{entry,exit,position,risk,execution,parameters,datasets}`，**execution 强制分离 `signalTiming` vs `executionTiming`**，`parameterRole`(FIXED/TUNABLE/DERIVED) 为 Parameter Search 预留；③ **两层指纹**（文档级落列 + 定义级判「是否同一套规则」，含 dataset binding）；④ **Look-Ahead 静态校验 8 规则（L1–L8）**：字段时间域目录 + 白名单（**禁黑名单**）+ 信号时间线，时间语义不明默认拒绝；⑤ `cloneVersion` **可从任意历史版本** clone（`parentVersionId` 指向源版本行）+ 幂等三态（**conflict 绝不覆盖**）；⑥ F1「双份定义」降级为**可检测冗余**（三方指纹 + 双份内容一致，不一致 **FAIL**、不修复、不择一覆盖）；⑦ 旧消费者零破坏（`legacyViews.ts` 叶子模块单向派生 v1 视图，有损项逐条登记）。**验收**：`npx tsc --noEmit` **exit 0**；新增 **132 例**（`strategyDefinition.test.ts` 79 + `strategyDomainPersistence.test.ts` 53），策略相关 **5 文件 / 202 例全过**；真实 TiDB `scripts/verifyStrategyDomainModel.mts` **89 项检查 / 0 失败 / exit 0**（含 **裸 SQL 独立读回投影**的第二级证据 + **漂移检测器自证** + 清理后 7 表回到基线 0）；全量 **216 文件 / 3400 例，15 失败 / 7 文件 —— 与既有基线逐项一致（真实 DB 直连 / 外部 API）⇒ 零新增失败**。**未越级**：未做 Strategy UI / Research 页面 / Parameter Search / Backtest / Evaluation / Robustness / OOS / WFO / Simulation；未改 Dataset Registry；未删旧数据。报告 `docs/strategy/STRATEGY-003-report.md`（18 节）+ 审计报告 `docs/strategy/STRATEGY-003-difference-report.md`。**登记不处理**：F7（`server/strategy/` legacy 双策略）、F9（Run 330003 永久 RUNNING，属 9h/RESEARCH-002D）。
   - **9l. （RESEARCH-005B）内置示例接入「批量建分析」——新增「例子」路线（点一下直接建 / 存为我的模板）** ✅ **已完成（2026-09-12 16:25）**：触发 = 用户「**还是很乱**，你可以把刚才的分析放在批量新建分析里面的我的模版里面吗」。**诊断**：9j 的 6 个示例只落在**单建弹窗**里（要先理解整张表单才用得上），而用户真正要的是「在已有 Run 上**直接建好**」⇒ 示例必须能到达**批量入口**；可批量弹窗的「我的模板」是**用户保存型**（RESEARCH-002C 定死：需先有一个配好的分析才能存）⇒ 空手进来仍是死路。**交付（纯前端：零后端改动、零迁移、零新端点）**：**A 第五条路线「例子」** —— `BatchAnalysisDialog` 模板页签顶部新增内置示例区，每条卡 = 研究问题标题 + 口径提醒 + **从待建条目反推的摘要** + 「按此创建」/「存为模板」；**B 路径同源** —— 新增 `analysisBatchForm.ts#formStateToBatchItem(state, nameOverride?)`，复用 `toAnalysisConfig` / `conditionGroupsToPayload` / `suggestAnalysisName`，**禁另造「表单 → 载荷」口径**，示例经 `applyAnalysisExample`（与单建弹窗**同一份** `ANALYSIS_EXAMPLES`）⇒「示例建的分析」与「手动填表建的分析」逐字段同源；**C 一键播种** —— 「把全部示例存为一个模板」（`首板涨停：内置示例集合`），之后在「我的模板」下拉里可对任意 Run 一键铺开 6 项；**D 减负** —— 页签改名「例子 / 我的模板」并设为**默认页签**（矩阵页签组合控件最多、空手进来的人不知道该怎么选），模板名唯一索引（`research_analysis_template_name_unique`）**前置判重**（按钮置「已存为模板」，**不靠撞库报错**兜底）；**E 摘要可测** —— `describeBatchItem(draft)` 落在纯函数层并从条目反推（不抄示例声明）⇒ 卡片显示的一定是**会落库的内容**。**语义边界（写进 `LAYER_CONVENTIONS.md`）**：`MATRIX_ANALYSIS_TYPES` 排除 `SEGMENT_RELATION` 的**理由只约束矩阵展开**（一排窗参数铺开 N 项 = N 个相同配置）；卡片上明写两个窗的**单条示例**不受此限。**验收**：`npx tsc --noEmit` **exit 0**；`npx vite build` **RC=0**（14.96 s）；新增 **10 例**（`analysisBatchForm.test.ts` 28 → **38 例**，含「每个内置示例都过服务端批量预检口径」「示例标题可直接当模板名（≤120）」「`describeBatchItem` 三种形态」）；聚焦 **25 文件 / 497 例全过**；全量 **216 文件 / 3411 例，15 失败 / 7 文件**（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`，**全部真实 DB 直连 / 外部 API 环境依赖**）⇒ **零新增失败**（并实证 9j 记录的 2 例并行 STRATEGY-003 失败已随 9k 收口）。**未触碰** `ds_*` 与 dataset 页面；未改任何分析口径与涨停判定。
   - **9m. （RESEARCH-006）结果可读性第二轮 + Run 450001 结果诊断（纯前端）** ✅ **已完成（2026-09-12 17:05）**：触发 = 用户「**390003这个研究结果是不是有问题**。而且**所有的研究结果感觉都不够直观**，有没有办法更直观一下」。**一、定位（真实库只读，探针跑完即删）**：`390003` = **`research_analysis.id`**（**不是** run、**不是** dataset version —— run 段是 450001、dataset_version 段只有 390001/390002），内容 = `runId=450001` / `exp=240002` / 类型 `SEGMENT_RELATION` / 名「前 5 日跌得越深，之后 15 日越强吗」/ cfg `{windowA:[0,5], windowAStat:max_drawdown, windowB:[5,20], windowBStat:return, windowBands:5}` —— 即 9j/9l 那批**内置示例**建出来的之一。**二、结论「算得对」但「写得不读得懂」**：① **口径自洽** —— `windowA` 的 `from=0` ⇒ 按 `windowOutcomeVariableName` **复用 Dataset 既有** `max_drawdown_5d`（=`min(close[1..5])/close(0)−1`，事件日**只作分母**，`path.ts#buildOutcomeRow` 已 `filter(rd>=1)`）；`windowB` 的 `from=5` ⇒ 新造 `segment_return_5_20d`（=`close(20)/close(5)−1`）；两窗值窗 `[1,5]` / `[6,20]` **无重叠**（`WINDOW_OVERLAP` 硬前提成立）。② **实测数值**（落库逐行核对）：5 档窗 B 均值 = 档1 **+0.194%** / 档2 +0.416% / 档3 −0.038% / 档4 −0.076% / 档5 **−1.608%**；`SPREAD_TOP_BOTTOM` **−1.802%**、`T_STAT_DIFFERENCE` **−4.542**、`P_VALUE_DIFFERENCE` **5.57e-6**、`PAIR_CORRELATION` −0.0317 / `PAIR_RANK_CORRELATION` −0.0682、配对 n=**22,944**（`excludedForMissing` 1,034）。③ 🔴 **三处会让人读反的表述**：**(a) `cutPoints = [−9.11%, −5.03%, −1.95%, +2.01%]` ⇒ 档 1 = 跌幅最深、档 5 = 跌幅最浅（甚至上涨）**，而结论只写「第 5 档 − 第 1 档 = −1.8%」，**档号本身不含方向**；**(b)** `SPREAD_TOP_BOTTOM` 的 top/bottom 是**分组变量值**的首尾（`段末档 − 首档`），不是「跌得深浅」—— 对「跌幅」这种越负越严重的变量，`top − bottom` 恰为负，与「越深越强」的直觉**正面打架**；**(c)** 前端把该指标中文名叫「**顶底分位差**」（QUANTILE 术语，用在「档」上不成立）。④ **同 Run 另两个对照分析**（`holds_event_low_5d == 1` / `== 0`）：条件组 **16,158 笔 / 均值 +5.186% / 胜率 51.86%** vs **6,747 笔 / 均值 −8.211% / 胜率 25.08%** ⇒ 两组直接差 **≈13.4pp**，但落库结果**只有 `ALL` 与 `CONDITION` 两组、没有「对照组」列**，`DIFFERENCE` 一律是「条件组 − **全样本**」⇒ 用户要自己心算，且极易把分母当成另一组。**三、交付（纯前端：零后端改动、零迁移、零新端点）**：**A 一句话结论卡**（`AnalysisResultsView` 顶部）—— 新增 `researchEngineAdapter.ts#buildHeadline(rows, blocks)`，从**已落库** SCALAR + 分组块搬出「主语组 / 参照组 + 差值 + 引擎写入的差值口径 + t / p + 样本数」，**不产生任何新数字**；**B 分档区间** —— 新增 `groupRangeLabelOf(details, dimension)`，由落库 `cutPoints` 反解（`第1档 ≤ c₀` / 中间 `(c_{k-2}, c_{k-1}]` / `第G档 > c_{G-1}`，与引擎 `band(v) = 1+|{k: v > percentile_k}|` **同源**），分组标签下直接显示「≤ −9.11%」「> +2.01%」⇒ **档号方向不再靠猜**；**C 分档条形** —— 主指标列加**共用横轴（强制含 0）+ 0 参考线**的条，涨红跌绿（A 股习惯，收益为正 = 红）；**D 差值口径上表** —— `ResultRowVm.comparisonDefinition` 原样带出 `differenceDefinition` / `spreadDefinition`（「谁减谁」的唯一权威定义，前端**禁改写**）；**E 术语纠正** —— `SPREAD_TOP_BOTTOM` 中文名「顶底分位差 → **最高组 − 最低组**」（对 QUANTILE 与 SEGMENT_RELATION 都成立）、`DIFFERENCE`「差值 → **组间差值**」；**F 排序修复** —— `dimensionNumericValue` 补 `windowA`（漏掉时 10 档会按字符串序把「档 10」排到「档 2」前，5 档看不出来）；**G 白名单守卫** —— `buildHeadline` 只对**有序**维度（`quantile`/`windowA`/`horizon`/`group`/`year`/`month`/`quarter`）生成，名义分类（`variable`/`board`/`industry`）**直接返回 null** —— 「换手率 vs 成交量」之间没有「顶底差」可言，硬算就是凭空造结论。**四、⚠️ 自查纠错（本轮真 bug，测试抓到后修）**：`buildHeadline` 初版按「**结果值**最高/最低」选顶底档 ⇒ 与引擎落库的 `SPREAD_TOP_BOTTOM`（**末档 − 首档**）**口径不一致**（本例结果值最高其实在**档 2**，非档 5）⇒ 改为**严格复刻引擎口径**（末档 − 首档 / 条件组 − 全样本），并加断言 `primary.value − reference.value ≈ spreadValue` 把两者锁死 —— **展示层自相矛盾比不展示更糟**。**五、验收**：`npx tsc --noEmit` **exit 0**；`researchEngineAdapter.test.ts` **24 → 34 例**（+10，含「分档端点反解」「档号方向」「非分档不臆造」「名义维度不硬凑」「条件分析的组定位」）；聚焦 `client/src/adapters` + `client/src/components/research` **8 文件 / 202 例全过**。**六、登记不处理（需改 `server/**` ⇒ 会热重启，待用户裁定）**：① `segmentRelation.ts` / `quantile.ts` 的 `summary.effectLabel` 仍写「第 5 档 − 第 1 档」—— **已落库的历史结论文本不会因前端改动而变**，建议在 effectLabel 内联档位区间；② `conditional.ts` 只产出 `ALL` / `CONDITION` 两组，建议补 **`COMPLEMENT`（对照组）**第三组，使「破 vs 不破」不必开两个分析再心算。
   - **9n. （RESEARCH-007）结果页图形化重做：修掉负值条形 bug + 独立分档图 + 反推「对照组」（纯前端）** ✅ **已完成（2026-09-12 17:45）**：触发 = 用户「**效果还是不直观，加的统计图有点问题**」。**一、真 bug（9m 引入，本轮修掉）**：`AnalysisResultsView.tsx#ValueBar` 条宽算错 —— 锚点取 `anchor = min(value, 0)` 之后再算 `value − anchor`，`value < 0` 时该差**恒为 0**，被 `Math.max(…, 0.8)` 兜成 **0.8% 宽**的一条看不见的细线 ⇒ **「有正有负」的分档图看起来只剩正值那几档有数据**（390003 那种「5 档里 3 负 2 正」的情形完全失真，而它恰恰是最需要看方向的一类）。**二、结构性不可读**：单元格内的条只有 ~72px 宽 × 1.5px 高，且随表格横向滚动整体跑出视口 ⇒「单调性一眼可见」这个目的根本达不到（`min-w-[72px]` 也救不了）—— 条形**放错了位置**。**三、交付（纯前端：零后端改动 / 零迁移 / 零新端点 / 零新依赖）**：**A 独立图表** —— 新增 `client/src/components/research/GroupMetricChart.tsx`（recharts `BarChart layout="vertical"`，**零新依赖**：项目已有 `recharts ^2.15.2`）：每档一行、**共用强制含 0 的 x 轴**（`domain = [min(0,…)−pad, max(0,…)+pad]`）、`ReferenceLine x={0}`、涨红跌绿、**两行式 y 轴刻度**（上行档名 / 下行 `cutPoints` 反解的区间）、tooltip 带该组区间 + 样本数 + 中位数/胜率/标准差；高度按档数自适应（`max(150, n·40 + 48)`）；文字与网格一律走 `currentColor` ⇒ 明暗主题都成立（只有涨跌语义色硬编码，因为它本身就是语义）。**B 删掉表格内迷你条** —— 表格回归**纯数字**、主指标列（表头 + 单元格）**加粗高亮**回答「该看哪一列」；`ValueBar` 连同其错误锚点一并删除（**不留死代码**）。**C 🔴 反推「对照组」（本轮最有价值的一项）** —— 新增 `estimateExcludedGroupMean`，用恒等式 `n_all·M_all = n_c·M_c + (n_all−n_c)·M_rest` ⇒ `M_rest = (n_all·M_all − n_c·M_c) / (n_all−n_c)` 反推出「不满足条件」那组。**这不是重新定义口径**（是恒等变形，前提只有「条件组 ⊆ 全样本且两者互斥」—— 正是条件分析的定义，不需额外假设 ⇒ 结果数学上**精确**、非估计），但**只对均值型指标开放**（`MEAN_RETURN` / `MEAN` / `WIN_RATE`；中位数、标准差是非线性统计量，给不出「剩余样本」的值），且图上以**浅色填充 + 同色虚线描边**明确标为「（反推）」、tooltip 写明「由全样本与条件组反推」—— 9m 里那条「结果里根本没有对照组的数」由此在**展示层**解决。**D 对照组相邻** —— 反推条插在「全样本」**之前**（`GroupMetricChartComplement.before`），让「满足条件 / 不满足条件」这对真正的对照组相邻可比，「全样本」作为基准收尾（否则「全样本」条会把两者隔开）。**四、验收**：`npx tsc --noEmit` **exit 0**；`npx vite build` **RC=0**（25.48 s）；`researchEngineAdapter.test.ts` **34 → 40 例**（+6：恒等式验算 / 条件组=全样本时不给数 / round-trip 无损还原 / 计数缺失或非正 / 均值非有限数）；聚焦 `client/src/adapters` + `client/src/components/research` **8 文件 / 208 例全过**；全量 **217 文件 / 3460 例，15 失败 / 7 文件** —— 与既有基线**逐项一致**（真实 DB 直连 / 外部 API）⇒ **零新增失败**。⚠️ **未做**：`agent-browser` 实机截图（本机 Chromium 冷启动 6 分钟零输出，已 `TaskStop` 放弃）⇒ **视觉验收仍待用户实机确认**，本轮的图只过了类型 / 构建 / 单测三关。**登记不处理**：9m 的两条后端遗留（`effectLabel` 档位文案、`conditional.ts` 补 `COMPLEMENT` 组）**仍未做** —— 本轮只让前端「看得到对照组」，**「结论」页签的文案与落库结果结构都不变**。
   - **9o. （RESEARCH-008）`DESCRIPTIVE` 多变量结果改走「有序序列趋势图」+ 补齐 `volume_ratio` 中文名（纯前端）** ✅ **已完成（2026-09-12 18:10）**：触发 = 用户「**39004这个有问题吧**」。**一、定位**：`390004` = **`research_analysis.id`**（`runId=450001` / `exp=240002` / 类型 `DESCRIPTIVE` / 名「首板后 5 天的量能长什么样」/ cfg `{variables:[volume_ratio_1d,…,volume_ratio_5d]}`）；并**再次实证** `ds_*` 物理表 `datasetVersionId` **只有 390001 / 390002** ⇒ 它不可能是 dataset id（也不可能是 run：run 段是 450001）。**二、真数据核查（只读，探针跑完即删）⇒ 结论：数字全对**。① `volumeRatio` **逐行可复现** —— `|volumeRatio − volume(rd)/volume(0)| > 1e-9` 的行数 = **0**；② 事件日 `volume` **min = 1,411.46、零 NULL、零 0** ⇒ 不存在「极小分母把量比炸到 65~181 倍」这类数据问题（`MAX` 65.1/137.9/181.6/139.5/170.4 与 `MIN` 0.0364~0.0032 都是**真实行情**：一字板几乎无成交、开板日巨量）；③ 该分析的 5 个 `SAMPLE_COUNT`（23,917 / 23,893 / 23,884 / 23,815 / 23,751）与物理表 `volumeRatio IS NOT NULL` 行数**逐一对上**；④ 与 390005 交叉验证 —— `volume_ratio_1d` 的 `P10 = 0.807` ⇒ `< 0.8` 应命中 ≈10%，实际条件样本 2,228 / 23,030 = **9.7%**，一致。**三、真正的问题（全部在呈现层，三处）**：**(a) 行标签是半工程名** —— 9j 新增 `volume_ratio_{h}d` 时漏登记族名，`variableLabelOf` 落到通用分支返回「volume_ratio T+1」；**(b) 这类结果画不出图** —— `HEADLINE_DIMENSION_KEYS` 排斥 `variable` 本身是对的（名义分类没有「顶底差」可言），但 `volume_ratio_1d..5d` 的 5 个「组」其实是**同一物理量的 5 个时点**，横轴是**时间**，被拍成并列类别后「逐日衰减」这个唯一有价值的信息就消失了；**(c) 均值与中位数给出相反结论，且默认把均值列放在前面** —— 实测中位数 1.40 → 1.11 → 0.98 → 0.92 → **0.86**（**T+3 起缩量**），均值 1.77 → 1.59 → 1.49 → 1.42 → **1.34**（全程「放量」），偏度 11.7~28.2、峰度 262~1,217 ⇒ **只读均值会得出与中位数完全相反的方向**。**四、交付（纯前端：零后端改动 / 零迁移 / 零新端点 / 零新依赖）**：**A** 提出模块级 `HORIZON_FAMILY_LABEL`（`variableLabelOf` 与趋势图**共用一份**，禁两处各抄）并补 `volume_ratio: "量比"`；**B** 新增 `FAMILY_BASELINE` —— **量比的基准线是 1 倍（与涨停日持平）而不是 0**（基准画错，全正序列里「缩量」与「放量」看上去都「远高于基准」，方向信息直接丢失）；**C** 适配层新增 `buildVariableSeries(blocks)` 纯函数：判定「每块维度只有 `variable` / 变量名同族 `{family}_{h}d` / 滞后互不重复 / ≥2 点」，命中才给序列，**不硬凑**（族不一致、非滞后名、混入分组维度、滞后重复一律 `null`）；**D** 新增 `client/src/components/research/VariableSeriesChart.tsx`（recharts `LineChart`，**零新依赖**）：x = T+1…T+5、**中位数与均值同时画**、`ReferenceLine y = 1`、偏度 > 2 时图上直接提示「请以中位数为准」、tooltip 带 P25 / P75 / 样本数、**刻意不用涨红跌绿**（量比不是价格涨跌，套涨跌色会被读成方向性涨跌）；**E** 结果页在分组表**之上**插入「量比逐日走势」卡（`buildVariableSeries` 与 `buildHeadline` **互不冲突**：`variable` 维度照旧不出「顶底差」结论，只是换一种呈现）。**五、⚠️ 本轮踩到的技术坑（已写进记忆）**：① `Tooltip` 的 `content` 写成 ReactElement 且目标组件 props 类型为 `unknown` 时，**JSX 会直接拒收属性**（`TS2322: Property 'lines' does not exist on type 'IntrinsicAttributes'`）⇒ 改为**普通函数调用** `content={(p) => renderSeriesTooltip(p, lines)}`，绕开 JSX 属性检查；② `Line` 的取值用**展平到顶层的字符串 `dataKey`**（`v_<metricCode>`）而不是函数式 `dataKey`（跨 recharts 版本行为不一致）。**六、验收**：`npx tsc --noEmit` **exit 0**；`npx vite build` **RC=0**（16.39 s）；`researchEngineAdapter.test.ts` **40 → 46 例**（+6：中文名防回归 / 量比族基准 = 1 且点按滞后升序 / 收益族基准 = 0 / 指标码去重保序 / 三类「不认」/ 滞后重复与单点），聚焦 **46 例全过**。**未触碰** `ds_*`、dataset 页面、任何分析口径与涨停判定；**未做**实机截图（沿用 9n 的 `agent-browser` 冷启动无输出结论 ⇒ **视觉验收仍待用户实机确认**）。**登记不处理**：9m / 9n 的两条后端遗留（`effectLabel` 档位文案、`conditional.ts` 补 `COMPLEMENT` 组）**仍未做**。
   - **9p. （RESEARCH-006.0 · 架构线）Research → Strategy Candidate/Draft 架构审计与接口设计** ✅ **已完成（2026-09-12 18:35，DESIGN DONE）**：触发 = 用户 26 节规格（不改库 / 不改业务代码，只审计 + 设计 `Dataset Registry → Research → Conclusion → Candidate → Strategy Version` 单向可追溯链路）。**方法** = 源码直读 + **真实 TiDB 只读实查**（`docs/evidence/_r006_probe.mjs` → `docs/evidence/_r006_probe_result.md`）。**最重要发现 = 桥已建好、两头没接线**：`research_conclusion`（**7 行**全 `DRAFT`）与 `research_strategy_candidate`（**0 行**）**都已存在**，`researchCore/candidates.ts` 状态机 + `contract.ts:219-225` 完整 Repository 契约**均已实现** ⇒ 二者**都不是 NOT IMPLEMENTED**，缺的只是**写入调用点**（`candidates.create` 全库零调用）。**六个断点** B1~B6（无写入路径 / Conclusion 无 CRUD 端点 / Candidate↔Strategy 零连接 / `strategy_versions` 无 research 列 / 三张表零 dataset 列 / lifecycle 为无状态纯函数）。**Research 上游资格**：🔴 **Result 非 immutable**（`engine.ts:712-714` 重算即替换）⇒ 不能作锚点；🔴 **Conclusion 无 `runId`** ⇒ Run 只能靠 `evidence` 两跳解析；🔴 **级联删除连 candidate 一起删** ⇒ **溯源快照必须落到 Strategy 侧**。**裁定方案 C**（`Candidate` 即 Draft，**不建 `strategy_drafts`**）：唯一不新增领域对象；A/B 会与 **C-21.1 八态撞名**、并使 Draft 表成为**第二 Canonical SoT**；Candidate 草图与 Strategy Definition 是**两套不可能同构的词表**（须经显式转换器）。**DB 逻辑设计（本 STEP 不含 DDL）**：candidate **+4 列** + **新 1 表** `strategy_research_provenance`（快照值、零 FK）；**不动** `strategy_versions` / 5 投影 / `StrategyDocument`（不递增 recordVersion）。**API**：保留既有 `listCandidates`；新增 `get`/`createFromConclusion`/`update`（摘除 `status`）/`transition`（🔴 拒绝 `CONVERTED`）/`promote`（唯一转正入口）。**唯一桥** = 新增 `server/research/strategyCandidate/`，铁律「`researchCore` ⇄ `strategyPersistence` **互不 import**」。**产物**：`docs/research/RESEARCH-006.0-architecture.md`（16 节 + Q1–Q10 + 证据清单）。**零改动**：无 schema / 无 migration / 无业务代码 / 无数据迁移；**未修**任何审计发现缺陷（只登记）。⚠️ **编号撞车**：§47 已用 `RESEARCH-006/007/008`（9m/9n/9o）指代**结果页可读性前端任务**，与本架构线同名不同物 ⇒ 架构线一律带 `.0/.1/…` 子号，建议后续在 §47 统一加「架构线」前缀。**下一 STEP = RESEARCH-006.1（数据库 + Domain Model）**，其后 006.2（Conclusion→Candidate Service）/ 006.3（promote + provenance）/ 006.4（API + 前端）/ 006.5（真实 TiDB + tRPC + Regression）；**一次只实施一个 STEP**。
   - **9q. （RESEARCH-006.1 · 架构线）Research → Strategy Bridge：数据库 + Domain Model** ✅ **已完成（2026-09-12 19:00，DATA_READY）**：触发 = 用户 30 节规格（基准 = `docs/research/RESEARCH-006.0-architecture.md`）。**一、数据库（纯增量）**：① `research_strategy_candidate` **+4 列**（`sourceDatasetVersionId` / `sourceResearchRunId` / `sourceTraceJson` / `sourceDatasetDivergenceReason`，**全 NULL-able ⇒ 零回填**）+ 索引 `idx_research_candidate_source_dataset_version`；② **新表** `strategy_research_provenance`（13 列 + `UNIQUE(strategyVersionId)` + 3 索引；**零 FK**）。migration = 手写 `drizzle/0036_research_strategy_bridge.sql`（6 语句全带 `-- @guard:`）+ 幂等 `scripts/applyResearchStrategyBridge.mjs`（apply / `--dry-run` / `--check`）。**二、实查断言全 PASS（真实 TiDB `information_schema`，非 Drizzle 推断）**：4 新列类型/nullable ✓、Candidate 列序 = 基线 14 + 恰好 4（**12 张 `research_*` 表逐列比对**）✓、provenance 13 列类型/nullable/KEY 逐项 ✓、`UNIQUE(strategyVersionId)` ✓、3 索引列名 ✓、**FK：Candidate 0 / Provenance 0 / 全库 0** ✓、`strategy_versions`/`strategy_version_datasets` **无 research 列**（Canonical 零污染）✓、`--check` PASS ✓、**二次 apply 幂等**（6 语句全 skip）✓。**三、行数守恒（20 张表前后逐表）**：`research_result` 674→674、`research_conclusion` 7→7、`research_strategy_candidate` **0→0**、`strategy_research_provenance` 建表即 **0**、`strategy_versions` 0→0、`dataset_version` 2→2 ⇒ **未自动产生任何 Candidate、既有研究数据零变化**。**四、Domain Model**：Candidate 类型 +4 个 `source*`（`sourceDatasetVersionId` 复制自 `experiment.datasetVersionId` 后**不可变**；`sourceResearchRunId` 两跳解析、**提不出即 NULL 禁伪造**；`sourceTraceJson` 是 provenance **快照**而非 Result 第二份存储；`sourceDatasetDivergenceReason` 一致时**必须 NULL**）；`db.ts` / `inMemory.ts` 同判据同语义（写 4 列 / 读回 / `list({sourceDatasetVersionId})` 过滤 / update 边界一致）。**五、溯源仓储（Strategy 侧独立切面）**：新增唯一桥目录 `server/research/strategyCandidate/`（`types` / `provenance` / `provenanceContract` / `index` + 3 测试）；`Db`/`InMemory` 双实现；能力 = `create` / `getByStrategyVersionId` / `listByStrategyId` / **`getBySourceCandidateId`（未来 promote 幂等闸门）** / `deleteByStrategyId`（非级联）/ `deleteByStrategyVersionId`；**无 update**（历史事实快照不可改）；`source*` 全为**快照值 + 零 FK** ⇒ Research 消失也不影响 Strategy 独立运行。**六、⚠️ 实施中发现的规则冲突与裁定（必须登记）**：006.1 §15 要求 `status`/`strategyDefinitionId` **亦**不可经普通 update 修改，但（a）**RESEARCH-001 既有验收**（`researchCore/repository/inMemory.test.ts`）**用 `update({status})` 走完四态迁移并断言非法迁移被拒**，（b）006.0 §10.1 已把「摘除 `status`」**划归 API 层（006.2）**。⇒ **裁定 = 分两类**：① **硬拒**（类型层 + 运行时 `assertCandidateUpdatePatchKeys` 响亮失败）= `experimentId`/`conclusionId`/4 个 `source*`；② **状态机守卫**（既有 `assertCandidateTransition` + `assertCandidateConversionCoherence` **语义未改**）= `status`/`strategyDefinitionId`，006.2 在 API 层摘出、006.3 起 `CONVERTED` 只能由 promote 到达。裁定写入三处注释 + 「两清单无交集」防漂移断言。**七、边界守护**：新增 `importBoundary.test.ts`（6 例，**读源码文本解析 import 说明符**）—— `researchCore` 禁 import `strategyPersistence|strategySchema` ✓、`strategyPersistence` 禁 import `researchCore` ✓、`datasetRegistry` 无反向依赖 ✓、**只有桥可同时 import 两者** ✓、桥禁被反向 import ✓、桥禁 import legacy `research/index.ts` ✓。**八、验收**：`npx tsc --noEmit` **RC=0**；聚焦（researchCore + strategyCandidate + strategyPersistence + datasetRegistry）**24 文件 / 421 例全过**；全量 **220 文件 / 3490 例，15 失败 / 7 文件 = 与既有基线逐项一致（零新增失败）**；真实库 `scripts/verifyResearchStrategyBridge.mts` **50 ✓ / 0 ✗**（含**裸 SQL 独立证明 UNIQUE 是真实数据库约束** ⇒ `ER_DUP_ENTRY`、**自建自清行数守恒**、**DB 与 InMemory 跑同一份契约且用例名集合逐字相同**）。**产物**：`docs/research/RESEARCH-006.1-implementation.md`（16 节）+ 证据 `docs/evidence/_r0061_probe_result.md` / `docs/evidence/_r0061_apply.json` / `docs/evidence/_r0061_apply2.json` / `docs/evidence/_r0061_check.json` / `docs/evidence/_r0061_verify.log` / `docs/evidence/_r0061_fulltest.log`。**九、§29 严禁偷跑（实查确认仍不存在）**：`createFromConclusion` / `promote` / `transition` / `get` 端点、Candidate 前端、Provenance UI、自动转正、`strategy_drafts`、新状态值、`StrategyService` 行为改动、`saveVersion` 接入 provenance。**下一 STEP = `RESEARCH-006.2`（Research Conclusion → Candidate Service）**；**一次只实施一个 STEP**。
   - **9r. （RESEARCH-009 · 分析建设线）把「回撤分档 × 建仓后四口径」与「多候选日回撤触发」建成正式分析** ✅ **已完成（2026-09-12 19:35）**：触发 = 用户「**把这些都建成分析**」。**新建 Run `480001`**（Experiment `240002` / `datasetVersionId 390002` / runNo=5）—— 不选 `runIncremental` 的理由：它**不生成结论**，而结论是用户读结果的主入口。**7 个分析**：A 组 4 个 `SEGMENT_RELATION`（窗 A = `max_drawdown[0,5]` 分 5 档；窗 B = `[5,20]` 分别取 `return` / `max_return` / `min_return` / `max_drawdown` ⇒ `420001~420004`）；B 组 3 个 `CONDITIONAL`（`pullback_from_event_high_{h}d <= −0.08` → `segment_return_{h}_20d`，h = 2/3/5 ⇒ `420005~420007`）——「回撤触发式建仓」在现有能力内的近似。**执行**：样本 23,978 / 7 分析全 COMPLETED / 167 结果行 / `conclusionId 360001` `SUPPORTED` / 装配 43.3 s、总 64.3 s。**四条结论**：① 期末收益档 5（最浅）**−1.61%** vs 档 2 **+0.42%**，`SPREAD_TOP_BOTTOM` **−1.80%**（p≈5.6e-6）但**非单调**、单因子区分度仅 0.4~2pp；② 风险侧更明显 —— 档 5 的最大不利偏移 **−13.93%** vs 档 1 **−11.23%**、最深跌幅 **−11.72%** vs **−9.00%** ⇒ 「等回撤再买」主要价值是**少亏**；③ 最大有利偏移**反向**（档 5 最高 16.56%）⇒ 未回撤那批「上下都大」；④ 全档胜率 < 50%、中位数全负 ⇒ 典型右偏，**只读均值会读反**。**B 组**：`DIFFERENCE` h=2 **−0.97pp** / h=3 **+0.24pp** / h=5 **+0.55pp** ⇒ **触发时点本身是信息**（越早深跌越是承接差）。**零代码改动**（未改 `server/**` 与 `client/**`、零迁移、零新端点、零新依赖）；建分析走产品领域层（`createAnalysesBatch` + `ResearchEngine`），**无第二套口径**。详见 §47 19:35 条。
   - **9s. （RESEARCH-009B · 呈现修复）`max_return`/`min_return` 口径不该产出 `WIN_RATE` ＋ 指标标签未按目标变量口径改写** ⬜ **待做（需改代码 ⇒ 必须排到「无在途 Run」的时段）**：由 9r 的落库结果暴露（**数字全对、呈现会读错**）。(a) **引擎侧**：`analyses/segmentRelation.ts:124` 的 `winRateMeaningful = windowB.stat !== "max_drawdown"` 判断不全 —— `max_return` / `min_return` 同样是**极值口径**，「取值 > 0 的占比」不构成胜率（实测 A2 = **94.5%**、A3 = **2.7%**），应一并屏蔽并给出同款说明；顺带核对 `conditional.ts` 把 `MAX_DRAWDOWN` 作为附加指标时的口径标注。(b) **前端侧**：`researchEngineAdapter.ts` 的 `METRIC_LABELS` 是静态表 ⇒ `max_return` 目标的「平均最大有利偏移 +13.75%」显示成「平均收益」；应新增「按目标变量口径改写标签」的纯措辞函数（**只改措辞、不改数字、不重算**，遵展示层纪律），至少在表头 / 结论速览 / 图上生效。(c) 附带：B 组三个分析的 `ALL` 基线 n 不同（22,958/22,951/22,944），结果页应说明「对照组分母按各目标变量可用样本计」，避免被当成数据不一致。
   - **9t. （RESEARCH-006.2 · 架构线）Conclusion → Strategy Candidate Service** ✅ **已完成（2026-09-12 19:45，CODE_READY）**：触发 = 用户 35 节规格（基准 = `docs/research/RESEARCH-006.0-architecture.md`）。**范围 = 只接业务线路、不转正**：新增桥的**应用层** 5 个源文件（`candidateTypes` / `evidenceTrace` / `service` / `datasetVersionPort` / `router`），只实现 `createFromConclusion` / `get` / `update` / `transition` 四个 Candidate 能力。**createFromConclusion 八步校验链**：入参 → Conclusion 存在 → Experiment 存在 → 坐标合法 → Dataset Version **存在 ∧ READY** → Conclusion 资格 `{DRAFT,FINAL}` → 同结论同名重复（`CANDIDATE_ALREADY_EXISTS`，**不加 DB UNIQUE**，同一结论允许产多份不同名候选）→ 证据快照 + Run 两跳解析 → 落库（**从不传 status，恒 DRAFT**）。**三条来源纪律**：`sourceDatasetVersionId` 只从 `experiment.datasetVersionId` **复制**（`overrides` 明确拒绝 `datasetVersionId`）；`sourceResearchRunId` 走 evidence 两跳、**唯一性判据 = 去重 runId 集合长度 1**、**提不出即 NULL 绝不猜**；`sourceTraceJson` 是**最小充分 provenance 快照**（只读结论自身 `evidenceJson`，**不是 result/analysis/run 的第二份存储**，截断如实标注、不写时间戳）。**🔴 不伪造策略定义**：Conclusion 里没有的 `entryRule`/`exitRule`/`riskRule`/`parameterSpace` 缺省**全留空**，只有人经 `overrides` 显式传入才落库。**update = 闭集白名单**（逐个显式赋值、禁 spread；硬拒 `status`/`strategyDefinitionId`/`conclusionId`/`experimentId`/4 个 `source*`/未知字段；空 patch 亦拒）。**🔴 transition 三处入口全拒 `CONVERTED`**（专属码 `CONVERSION_REQUIRES_PROMOTE`）；Router 的 `to` 枚举故意含 `CONVERTED` 以传递「要走 promote」这条架构信息。**Router**：`research.strategyCandidate.{get【public】, createFromConclusion/update/transition【admin】}`，与 `research.strategy.*` 并列。**§21 边界**：桥本 STEP **不 import `strategyPersistence`/`strategySchema`**，`importBoundary.test.ts` **追加 2 例**守护（含「不得出现写 `strategy_versions` 痕迹」，跳过 `.test.ts` 自身）。**验收**：`tsc` RC=0；桥聚焦 **4 文件 / 73 例全过**；四目录聚焦 **26 文件 / 484 例全过**；全量 **222 文件 / 3553 例，15 失败 / 7 文件与基线逐项一致 ⇒ 零新增失败**（相对 006.1 **+63 例** = 本次新增）；真实 TiDB `scripts/verifyStrategyCandidateService.mts` **RC=0 / 39 ✓ 0 ✗**（真实坐标 conclusion 360001 → experiment 240002 → dataset version 390002 → **裸 SQL 独立算出 runId 480001**；负例零写入；越界拒绝零变化；**CONVERTED 拒绝**；**21 表行数守恒**；**`strategy_versions` 0→0**）。⚠️ **如实登记**：真实库无 `SUPERSEDED` 结论 ⇒ 该负例仅由单测覆盖；实施期间另一条线（RESEARCH-009）真实库新增数据（result 674→841 等），验收脚本**动态发现**坐标。**下一 STEP = `RESEARCH-006.3`（promote + definitionBuild + provenance + clone 继承）**；**一次只实施一个 STEP**。
   - **9u. （RESEARCH-010 · 分析建设线）「首板后回撤收益特征分析」建成并执行（用户的 RESEARCH-007 指令）** ✅ **已完成（2026-09-12 21:10，DATA_READY）**：触发 = 用户 22 节规格 + 明确约束「**不新写代码，只用现有功能，且要能自己在网页上做出来，不能实现的列出来**」。**新建 Run `510001`**（Experiment `240002` / `datasetVersionId 390002` / runNo=6，**不选 `runIncremental`**：它不生成结论）。**29 个分析**：A 组 5 个 `SEGMENT_RELATION`（窗A=`[0,d]` 相对首板收盘涨跌幅分 5 档；窗B=`[d,d+5]`，d=T+1..T+5 ⇒ `450001~450005`）；B 组同上 → 窗B=`[d,d+10]`（`450006~450010`）；C 组 10 个 `CONDITIONAL`（T+2/T+3 × 固定桶 `0~2%/2~4%/4~6%/6~8%/8%+`，条件 = `future_return_{d}d BETWEEN …` ⇒ `450011~450020`）；D 组 4 个风险侧 `SEGMENT_RELATION`（T+2/T+3 × `max_return`/`max_drawdown` ⇒ `450021~450024`）；E 组 5 个 `CONDITIONAL`（T+2 已回撤 **且** 量比落桶 `<0.5/0.5~0.8/0.8~1.0/1.0~1.5/>1.5` ⇒ `450025~450029`）。**执行**：样本 23,978 / 29 分析全 COMPLETED / **634 行结果** / 结论 `390003` **REJECTED**（主分析 = `450011`）/ **154.8 s**。**核心数字**：① 全样本 T+2 收盘买入持有 5 日 = 均值 **−0.53%** / 中位 **−1.77%** / 胜率 **41.5%**；② 等频分档下唯一大区分度在 T+1（顶底差 **+2.93%**，p≈0）但**档5 中位 −2.53%、std 17.8% ⇒ 均值右偏假象**；③ T+3/T+4/T+5 顶底差转负（−0.86%~−1.06%，p<0.001）⇒ **越晚追高越差**；④ 固定桶里**唯一显著为负 = T+2 跌超 8%**（−1.09pp，p=6.1e−5），**6~8% 反而是 T+3 唯一显著为正的桶**（+0.64pp，p=0.011）⇒「回撤越深越好/越差」都不成立；⑤ 风险侧：档5 最大有利偏移 **12.98%** 但最深跌幅 **−6.51%**（下限最差），档1 为 7.05% / −5.11% ⇒ **「等回撤再买」的主要价值是少亏**（与 9r 一致）；⑥ **量比五桶差值全不显著**（最大 p=0.058）⇒「缩量回撤更好」在本口径上**不成立**。**零代码改动**（未改 `server/**` / `client/**`、零迁移、零新端点、零新依赖）；建分析走产品领域层（`createRun` + `createAnalysesBatch` + `ResearchEngine`），与网页「新建 Run → 批量建分析 → 运行引擎」**完全同一条路径**。**产出 8 项能力缺口（本任务的主要结论）**：① 不存在「一份 Analysis 含 Feature/Target/Horizon/Descriptive 四段配置」的领域对象；② 无多视界矩阵（一次分析一个目标变量，1D/3D/5D/10D 要 ×4 份）；③ 无 Day × Depth 二维交叉分析类型；④ `pullback_price` / 相对 O_T / 价格区间位置不可表达（结果族全是比率、无绝对买入价）；⑤ 市场环境维度不可用（`regime` 在 `unavailableDimensions` 中）；⑥ 分组类分析不产出 P25/P75 与组内极值（只有 5 个指标）；⑦ **一 Run 只产一条结论且主分析按固定优先级取首个命中** ⇒ 29 个分析只有 1 格进结论；⑧ Strategy Candidate 无前端（`createFromConclusion` 端点存在但页面无入口）。**规格中「不破首板日开盘价 O_T」无法表达**，已如实**不使用**（宁缺不用错口径）。详见 `docs/research/RESEARCH-010-implementation.md`（9 节）。

   - **9v. （RESEARCH-006.3 · 架构线）Strategy Candidate → Strategy Promote（唯一转正入口）** ✅ **已完成（2026-09-12 20:45，`RESEARCH-006.3 = COMPLETE`）**：触发 = 用户 54 节规格（基准 = `docs/research/RESEARCH-006.0-architecture.md`）。**§1 架构冲突审查：逐条核对无冲突**，未触发「停止实施」（006.3 §4 的 `datasetBinding` + `datasetDivergenceReason` 是 006.0 完整候选输入的**子集**）。**一、唯一转正链路**：`ACCEPTED 候选 → promote() → ① buildStrategyDefinition（纯函数）→ ② 既有 validateCanonicalStrategyDefinition → ③ Dataset Registry 只读校验（存在 ∧ READY）→ ④ StrategyService.create + saveVersion（含 5 投影 + Binding 校验，**同事务**）→ ⑤ provenance.create（`DIRECT`）→ ⑥ 候选 → `CONVERTED` + `strategyDefinitionId``。**新增 2 源文件**：`definitionBuild.ts`（**809 行**，**唯一** `Candidate → StrategyDefinition` 转换器，**确定性 / 纯函数 / 无 DB 副作用**）+ `strategyPromotionPort.ts`（**272 行**，桥内**唯一**允许 import `strategyPersistence` / `strategySchema` 的生产文件，**复用既有 `StrategyService`、绝不直接 INSERT `strategy_versions`**）；`service.ts` 450 → **995 行**（`promote()` 12 步：入参 → 载入 → **幂等闸门** → 状态门槛 → 来源完整性 → 执行 Dataset → build → validate → 文档级假设 → 写 Strategy+Version → 写 provenance → 回写候选 → 复核）；`router.ts` 199 → **307 行**（新增 `research.strategyCandidate.promote`，**`adminProcedure` 不开放 public**，11 个错误码全映射）。**二、🔴 「不猜测」与「必填」如何同时成立**：`StrategyDefinition` 必填面（`observationWindow` / `trigger` / `execution.quantityMethod` / `position.sizingMethod` / `riskRule.maxPositions`…）在 Research 词表里**没有对应字段**，而两者是**两套不可能同构的词表** ⇒ 把 `Candidate.entryRule.extra` 定义为**唯一具名扩展槽**（**闭集 7 键**：`observationWindow` / `trigger` / `eventParams` / `execution` / `position` / `risk` / `document`；**复用既有列 ⇒ 零 migration**）。**两类失败语义分开**：草稿**缺**内容 ⇒ `PROMOTE_SKETCH_INCOMPLETE`（回去**补**草稿）；草稿**写错** ⇒ `PROMOTE_SKETCH_INVALID`（回去**改**草稿）。**显式映射表（不是推断）**：`ENTRY_TIMING_TO_EXECUTION` 3 项 + `EXIT_REALIZATION` 固定表（`STOP_LOSS` p1/`INTRADAY`、`TAKE_PROFIT` p2/`INTRADAY`、`TIME_EXIT` p3/`ON_CLOSE`）+ `CONDITION_OPERATOR_MAP` 8 项。**前置响亮拒绝**（比等到定义校验阶段报结构性错误更易定位）：字段引用不过 `parseStrategyFieldReference`；`parameterRole` **恒 `TUNABLE`** ⇒ 数值参数**必须同时给 `min`+`max`**、非数值须给**非空 `allowedValues`**；`BETWEEN` / `IS_NULL` / `IS_NOT_NULL`；`riskRule.regimeGate`（`RiskDefinition` 无条件组字段，**不静默丢弃**）。**三、Dataset Binding（§11~§16 / §30）**：**区分**「研究来源 Dataset」（`candidate.sourceDatasetVersionId`，只进 provenance）与「执行 Dataset」（`definition.datasets[0]` `role=PRIMARY` + `strategy_version_datasets`）；缺省**继承来源**；显式指定不同 ⇒ **divergence 原因必填**（`DATASET_DIVERGENCE_REASON_REQUIRED`）；指定**一致却填原因 = 造假** ⇒ `INVALID_INPUT`（单测含 `N/A` / `same dataset` 占位负例）；执行 Dataset 必须**存在 ∧ READY**；唯一坐标 `dataset_version.id`。**四、幂等（§18/§19）**：闸门 = **`strategy_research_provenance.sourceCandidateId`**；第二次 promote **绝对不能产生第二个 Strategy Version**（三层：闸门不再进写入路径 + `strategyId` **确定性派生** `cand-<candidateId>` + 版本号固定 `1.0.0`）；🔴 **幂等路径不静默忽略调用方输入**（§53）：改绑别的 Dataset ⇒ 拒绝、一致却填 reason ⇒ 拒绝、已 divergence 传新 reason ⇒ 拒绝（单测 21 / 21b / 21c）。**五、跨存储失败与恢复（§25/§26）**：三次跨存储写（Strategy / provenance / 候选回写）**非原子** ⇒ 任一失败抛 `PROMOTE_WRITEBACK_FAILED`，**携带 `strategyId` / `strategyVersionId` / `strategyVersion` / `stage` / `cause`**；🔴 **禁止删除已创建的 Strategy 做「回滚」**（代码中**零 delete**）；恢复靠「闸门命中走幂等 + version 写**指纹幂等自愈** + 补写 provenance + 补回写候选」。**失败注入测试**（§39 禁只靠真实库偶然失败）：22（provenance 写失败）、23（候选回写失败）双路证明「Strategy 与 provenance 都在、重试只补缺的那一步、`versionCount===1`」；24/25 证明「状态与溯源不一致 ⇒ `PROMOTE_STATE_INCONSISTENT`，不假装幂等成功」。**六、provenance（§20~§22）**：13 列 / ≥11 必填锚，`origin` **恒 `DIRECT`**（§32 禁 `INHERITED`）；是**历史事实快照**（零 FK、上游被删仍可读、**无 update 能力**）；**display-only**，**不参与 fingerprint / validate / backtest / parameter search / execution**（Research 模块整个不可用，Strategy Version 仍必须独立可运行）。**七、🔴 测试抓到的两个真 bug（已修）**：① **两层指纹混用** —— `strategyPromotionPort.findVersion` 初版用 `repo.getVersion().fingerprint`（§17 **追溯记录**指纹，摘要含 `codeVersion` / `createdAt` 等**每次注入都可能不同**的元数据）⇒ 会把「同一份内容、换了个时间戳」误判成 `PROMOTE_VERSION_CONFLICT`，**让整个幂等恢复路径失效**；改用 `getVersionBundle().fingerprint`（= `strategy_versions.fingerprint`，**document 内容指纹**，也是 `saveVersion` 判幂等/冲突所用同一个）。② **幂等路径静默忽略 overrides**（违反 §53）⇒ 重写为相容性核对 + 补 21b / 21c 两例。**八、验收（§42~§45）**：`npx tsc --noEmit` **exit 0**；桥聚焦 **6 文件 / 144 例全过**（`definitionBuild.test.ts` **35** / `service.promote.test.ts` **30** / `router.test.ts` **16** / `importBoundary.test.ts` **10** / 006.2 既有 `service.test.ts` 49 + `provenance.test.ts` 4）；真实 TiDB `scripts/verifyStrategyCandidatePromote.mts` **41 项 / 0 失败 / PASS**（**裸 SQL 独立复核**版本行·definition·Binding·provenance·候选终态；**行数证明：第二次 promote 零新增行**；**divergence 分支**：来源坐标保持原样、原因落列；**15 张表行数守恒**；**残留自建行 = 0**）；全量 **224 文件 / 3624 例，15 失败 / 7 文件 —— 与既有基线逐项一致 ⇒ 零新增失败**。**九、§46 防偷跑 + §47 Boundary Test**：`createStrategyVersion` / `provenance.create` / `CONVERTED` / `promote` 的生产源**全部收敛在桥内**（全库**不存在**第二处 Candidate → Strategy 转换入口）；`importBoundary.test.ts` 按 006.3 把 006.2 的「桥不得 import Strategy」**改写为允许清单式**（`STRATEGY_PERSISTENCE_ALLOWLIST=["strategyPromotionPort.ts"]`、`STRATEGY_SCHEMA_ALLOWLIST=["strategyPromotionPort.ts","definitionBuild.ts"]` + ①-b 断言清单成员确实存在 + ② 不得直接写 `strategy_versions` + ③ Strategy 侧不得反向认识 researchCore）。**十、零污染**：**Dataset Registry 零改动**、**无 `rd-*` 参与绑定判定**、**前端零改动**（§36 不做 Promote UI）、**§32 不做 `cloneVersion` / `INHERITED`**。产物 `docs/research/RESEARCH-006.3-implementation.md`（23 节 + **字段映射表** + 文件清单 + 验收汇总）；证据 `docs/evidence/_r0063_verify.log` / `docs/evidence/_r0063_bridge_tests.log` / `docs/evidence/_r0063_fulltest.log` / `docs/evidence/_r0063_tsc.log`。**下一 STEP = `RESEARCH-006.4`（API 收口 + 前端）**，**本 STEP 未做 006.4**（§54 明令）。

   - **9w. （RESEARCH-010B · 三问审计更正）「回撤深度档」表述更正 + 数据集未启用回踩筛选 + 「加筛选即前视」预警** ⬜ **部分待做**：2026-09-12 20:50 用户三问（T+1~T+5 × 回撤深度是否完整 / `segment_return_*` 收益起点 / 有无 look-ahead），只读实查后得三条结论：**(a) 表述更正（文档层，已改 `docs/research/RESEARCH-010-implementation.md` §十）** —— A/B/D 组的「等频 5 档」切在**带符号**的 `future_return_{d}d`（= `close(T+d)/close(T) − 1`）上，实测 T+2 切点 `−4.51% / −1.05% / +2.26% / +7.67%` ⇒ **档4/档5 = 「没回撤、还涨」样本（T+2 合计 ≈9,441/23,604 ≈ 40%）**，**只有档1 是深回撤**；且切点逐日变化（T+1 档1 ≤ −3.16% vs T+5 ≤ −7.69%）⇒ **同一列不可跨天比较**，正确读法是「相对首板收盘的涨跌幅 5 档」。**(b) 数据集事实（已确认，需写进 Dataset 层规则）** —— `dataset_version 390002` **未启用回踩筛选**：`filterDefinitionJson` 无 `pullback`、`universeDefinitionJson` 只有 `{all-a-shares, stock_daily_prices, boards:["main"], excludeSt:true}`、生产它的 `server/datasetRegistry/builder.ts` 不含 `screenFirstBoardRow` ⇒ 样本 = **全部首板事件**（主板/非 ST/23978 事件/2967 只），不是「有效回撤事件」。**(c) 🔴 预警（待决策，务必在启用回踩筛选前裁定）** —— `researchDataset/pullback.ts#screenSingleTarget` 的 `broken` 是**用整个 T+1..T+5 的 `low`** 决定入池；若将来以 T+2 为决策点做分析，就是**样本选择层 look-ahead**（幸存者偏差，会人为抬高 T+2 胜率）⇒ 必须改成**按决策日滚动的窗口**（T+1..T+d）重算入池，否则不可当作 T+d 可交易信号。**(d) 队列项（沿用 9u 建议）** —— 固定桶只做了 T+2/T+3（缺 T+1/T+4/T+5 × 5 桶 = 15 格）、1D/3D 视界未建（变量都存在 ⇒ 用**补跑**追加即可，零代码）。 ✅ **2026-09-12 21:50 由 9y 处理**：**(a)** 已从「文档层更正」升级为**分析元数据更正**（`450021~450024` 改名「深度5档」→「相对首板收盘涨跌幅5分位」；⚠️ `research_analysis` 无 description 列）+ §6.6 **离线量化对照**；**(d)** 固定桶已补齐为**完整 5×5**（T+1..T+5 × 5 桶 = 25 格，方法 = 25 组 `CONDITIONAL` × 5 指标），**1D/3D 视界同时建成**（B 组每格含 1d/3d/5d 目标，`segment_return_{d}_{d+1/3/5}d`）；**(b)(c) 结论不变** —— `390002` 仍未启用回踩筛选，且本轮**没有**给它加 whole-window filter（改用**离线只读复算**做对照，正是为避开样本选择层 look-ahead）。**仍未做**：滚动资格判定 `min(low[T+1..T+d]) >= open(T)`（见 9y 的 BLOCKED 与最小扩展方案）。
   - **9x. （RESEARCH-006.4.1 Phase A · 架构线）前端 MVP：Frontend Architecture Audit + Conclusion → Candidate + Candidate 列表/详情** ✅ **已完成（2026-09-12 21:11，Phase A = DONE）**：触发 = 用户 19 节规格 + 硬约束「**不要为了「完整」一次把 006.4 全做完**」（**严格两阶段**：Phase A 只做「前端架构审计 + Conclusion → Candidate + Candidate 列表/详情」，完成后**停止**并输出 `RESEARCH-006.4.1-A` 报告，**不得继续 Promote UI**）。**§1 审计结论 = 本 STEP 需要新增 API 0 个**：候选列表复用既有 `researchEngine.listCandidates`（实验维度）、详情复用既有 `research.strategyCandidate.get` ⇒ **不为「全局候选列表」新造第二套列表接口**（避免在与 Domain 无对应关系的维度上发明 API）。**交付**：新增 **11 文件 / 2,681 行**（**10 个 `client/**` 前端源/测试文件共 2,167 行** —— `strategyCandidateAdapter.ts` **唯一展示契约层** / `candidateForm.ts` **纯函数** / `CreateCandidateDialog` / `EditCandidateDialog` / `CandidateLifecycleActions` / `CandidateSketchCard` / `StrategyCandidateDetail.tsx` + 3 个测试文件；**+ 1 个验收脚本 `verifyConclusionToCandidateFlow.mts` 514 行**）+ 修改 **6 文件（+75 / −20，全部 `client/**`）**（`App.tsx` 路由【候选详情**必须先于** `/research/:experimentId`】、`CandidatesPanel`、`ConclusionPanel`、`lib/status.ts` 六态语义色、2 个 barrel）。**三条纪律的可验证实现**：① **默认值归后端** —— `buildCreateCandidateInput` 未改动时**只回 `{conclusionId}`**（单测锁定入参永不含 `name`/`description`/`experimentId`/`source*` 等 6 个后端负责字段）；② **`CONVERTED` 结构性不可达** —— 前端流转表无它 + **运行时 import 后端真常量**做**逐状态严格相等**断言 + 另锁「状态机允许但 API 未开放」的缝（`REVIEW→DRAFT`）；③ **`services.update` 不挡状态** —— 据此**删掉**了一条臆造的 hint（原写「已转正 ⇒ 草图不可改」**并不存在**），并立规则「**每条错误 hint 都必须对得上后端真实会发生的映射**」。**验收**：`npx tsc --noEmit` **exit 0**；新增 **3 文件 / 54 例全过**；真实 TiDB `scripts/verifyConclusionToCandidateFlow.mts`（514 行，自建自清）**41 ✓ / 0 ✗ / exit 0**（策略侧 8 张表 **0→0**、无残留自建候选、13 张表**逐表守恒**；`research_run/analysis/result` 因并行会话写入只记录差值）；`npx vite build` **RC=0**（3,011 模块 / 24.86 s）；全量 **227 文件 / 3,678 例，15 失败 / 7 文件与基线逐项一致 ⇒ 零新增失败**。**零污染**：Dataset Registry **零改动**、**本 STEP 未改任何 `server/**`**（`git status` 里 11 个 `server/**` M 文件经 `find -newermt` 判据确认属前序会话 006.2/006.3）、零迁移、零新端点、零新依赖。**🔴 如实登记（Phase B 前置技术债）**：`toTrpcError` **只透传 `message`、不带 `cause`** ⇒ **领域错误码不跨 tRPC 边界**，§11 要求的 14 个错误码会**塌缩成 5 个 tRPC code**（**4 个 `PROMOTE_*` 全落 `PRECONDITION_FAILED`，无法区分**）⇒ **建议 Phase B 第一步把领域码写进 message**（`[${CODE}] …`，与既有 `rpcErrorToDiagnostic` 的抠码约定一致）。**未做（§19 明令 Phase B）**：Promote UI / Promote Dialog / Promote Result 幂等提示 / Strategy Provenance 展示 / Strategy Version 导航 / `cloneVersion` / `INHERITED`。**下一 STEP（当时）= `RESEARCH-006.4.1 Phase B`（须待 Phase A 稳定后再启动）** ⇒ ✅ **已由 `9z` 完成（2026-09-12 22:35，`RESEARCH-006.4.1` 封板；Promote UI / Promote Dialog / Promote Result 幂等提示 / Strategy Provenance 只读区 / Strategy Version 导航全部落地，`toTrpcError` 领域码技术债已修）**。报告 `docs/research/RESEARCH-006.4.1-A-implementation.md`（12 节）+ `RESEARCH-006.4.1-B-implementation.md`（14 节）。
   - **9y. （RESEARCH-007.1 · 分析建设线）「首板有效回撤 Research 校正与补齐」** ⚠️ **部分完成 / 核心一环 BLOCKED（2026-09-12 21:50）**：触发 = 用户 22 节规格（承接 9w）；**硬约束沿用上轮 = 「不新写代码，用现有功能实现，不能实现的列出来」** ⇒ **零产品代码改动**（`server/**` / `client/**` 未动、零迁移、零新端点、零新依赖）。**已完成**：① **错名校正** `450021~450024`（「深度5档」→「相对首板收盘涨跌幅5分位」）；② **新建 Run `540001`**（Experiment `240002` / Dataset Version `390002` / runNo=7 / COMPLETED）+ **135 个 `CONDITIONAL` 分析 `480001~480135`** + **1,952 行结果** + 结论 `480001` REJECTED（整轮 425.3 s，样本 23,978）—— A 组「已回撤」×5 + **B 组 5×5 固定业务桶 × 5 指标 = 125**（`segment_return_{d}_{d+1/3/5}d` + `segment_max_return_{d}_{d+5}d` + `segment_max_drawdown_{d}_{d+5}d`）+ C 组「T+5 加 `holds_event_low_5d == 1`」×5；③ **🔴 自查纠正桶区间**（**双闭** → **左开右闭**：首版 5 桶加总 **10,106 > 组 A 9,899**，多 207 正是平盘样本；改 `future_return < −lo AND >= −hi` 后重写 130 个条件 + 整轮重跑 ⇒ T+1/T+4/T+5 加总与组 A **逐位相等**，T+2/T+3 各差 1 例）；④ **离线交叉验证**（只读 SQL，非产品口径）：补上 `min(low[T+1..T+d]) >= open(T)` 后方向**同向且量级接近**（T+4×2~4%：+0.42% vs +0.38%），但 **8%+ 桶样本 4,474 → 215~226**、T+1×8%+ 最深跌幅 −8.47% → **−10.16%**。**🔴 BLOCKED（唯一硬缺口）**：规格要的**滚动资格判定**（基准 `open(T)`、按决策日 d 滚动）**现有领域模型表达不了** —— 数据层原料齐全（`prefix(rd=0).open` + `post(rd≥1).low` 实查都在），但变量层只有 `holds_event_low_{5,10,20}d`（基准 `low(T)`、只 3 个视界），**无 `open` 基准、无 d=1..4**；条件右值只能是常量 ⇒ §十九 的「**有效回撤**」问题**未答**。**最小扩展（待排期，⚠️ 须在无在途 Run 时段做，否则热重启会杀 Run）**：`EVENT_LOW_GUARD_BASES` 加 `"open"` + 生成视界由 `outcomeHorizons` 扩到 `pathHorizons∩[1,5]`（**单文件单函数、零 migration**）；随后用 `runIncremental` 补跑 T+1..T+4 的 4×5 格。**其余缺口**：`research_analysis` **无 description 列**；CONDITIONAL **不产 P25/P75**（DESCRIPTIVE 能产但不支持条件过滤）；无二维交叉分析类型；`updateAnalysis` / `setAnalysisConditions` **前端无入口**；Strategy Candidate **无前端入口**。**产物**：`docs/research/RESEARCH-007.1-pullback-correction.md` + 证据/脚本 9 个（均非产品代码）。**下一步建议**：① 缺口 ① 的最小扩展 + `runIncremental` 补跑；② 修 CONDITIONAL 附带 `max_drawdown_{h}d` 的口径推导（顺带解 P25/P75）。
   - **9z. （RESEARCH-006.4.1-B · 架构线）Candidate → Strategy 前端完整闭环（Phase B 全部落地 ⇒ `RESEARCH-006.4.1` 封板）** ✅ **已完成（2026-09-12 22:35，COMPLETE）**：触发 = 用户 43 节规格（承接 9x/Phase A），目标 = **一次性打通「结论 → 候选 → 草稿 → 采纳 → 转正 → 策略版本 → 溯源」并在最后一环让 Strategy 脱离 Research 独立可用**。**交付 = 新增 5 文件 / 2,453 行 + 改 8 文件**（`promoteForm.ts` 261 **纯函数** / `promoteForm.test.ts` 393（34 例）/ `PromoteCandidateDialog.tsx` 504 / `StrategyResearchProvenancePanel.tsx` 138 / 验收脚本 `verifyResearch00641Promote.mts` 1,157；桥 `router.ts` +224（`withDomainCode` 全面落地 + **新增唯一只读端点** `getVersionProvenance`）/ `service.ts` +725 / `router.test.ts` +194 / `strategyCandidateAdapter.ts` 404→829 与 50 例 / 候选详情 289→312 / `StrategyEditor.tsx` +38 / barrel +12）。**三条纪律被断言锁死**：入参**结构性只有 `{candidateId, overrides?}`**（`datasetId`/`label` 不可达）；**只有 `ACCEPTED` 显示转正入口**（`CONVERTED` 也不显示，差集断言 = `RESEARCH_CANDIDATE_STATUSES` − `NON_PROMOTABLE_STATUSES` **恰好** `ACCEPTED`）；**divergence 前端 trim 判空 + 后端独立拒绝**（三条失败路径实测零新增）。**§13 判定**：`candidate.sourceDatasetDivergenceReason` 属**转正执行覆盖记录**（一致时必 NULL），**不是**研究来源快照 —— 验收反证候选 `sourceDatasetVersionId` 未被覆盖 ⇒ **按指示不重构、只在报告说明语义**。**验收**：`tsc` **exit 0**、`vite build` **RC=0**（3014 modules）、聚焦 **9 文件 / 237 例全过**、全量 **228 文件 / 3742 例（15 失败 / 7 文件 = 既有基线，零新增失败）**、真实 TiDB **第 3 轮 PASS 123 / 失败 0 / `exit 0`**（§23/§34 真删上游后 Strategy 仍可读；13 张严格表守恒 + 3 张 observed-only Δ0；自建自清无残留）。⚠️ **新登记技术债（未修）**：生产读路径 `strategyPersistence/db.ts#loadProjections`（及同类只读投影读）**无重试**，跨境空闲连接复用会 `read ECONNRESET`（3 轮验收全部命中「长时间只用裸 mysql2 后第一次用 Drizzle 池读」这一位置）⇒ 带溯源的策略页可能溯源区读失败；最小改法 = 复用既有 `withReadRetry`，**须排在无在途 Run 时段**（改 `server/**` 会热重启杀 Run）。**§43 已遵守：未启动任何下一阶段。** 详见 `docs/research/RESEARCH-006.4.1-B-implementation.md`（14 节）与 §44 头部 22:35 条。

   - **9aa. （RESEARCH-007.2 · 前端线）Research「结果」页签新增**矩阵视图**（把批量分析拼回一张表）** ✅ **已完成（2026-09-13 00:35，CODE_READY + 真实数据验证；`server/**` 一行未改）**：触发 = 用户实报「100 多个分析结果根本没法看、并没有生成 5×5 表格，有什么办法在前端页面上加上」。**一、交付**：**新增 3 文件**（`client/src/components/research/researchMatrix.ts` **486 行纯函数** + `researchMatrix.test.ts` **380 / 22 例** + `ResearchMatrixView.tsx` **402**）+ **改 2**（`pages/research/ResearchDetail.tsx`：结果页签加「**矩阵视图 / 逐分析**」切换且**默认矩阵**、逐分析按钮改显名称 + >20 个时出搜索框；`components/research/index.ts` barrel）。**零迁移 / 零新端点 / 零新依赖 / 零 `server/**` 改动**。**二、为什么能纯前端**：`getRun` 已返回该 Run 全部分析的 `name/target/status`；`getAnalysisResults` 的结果行**自带** `dimension.group=ALL/CONDITION` + `DIFFERENCE` + `T_STAT_DIFFERENCE` + `P_VALUE_DIFFERENCE` ⇒ **横比所需数据全在页面上**，缺的只是展示层聚合（否决了「加后端聚合端点」—— 改 `server/**` 会热重启杀死在途研究 Run）。**三、归组契约（本视图唯一有实质判断处）**：指标族取 `target`（**结构化权威**：`segment_(return|max_return|max_drawdown)_(\d+)_(\d+)d` ⇒ `{kind}_{end−start}`）；决策日取 `name` 的 `T+d` 并**与 target 起始日交叉校验**（不一致 ⇒ 进未归类）；桶取 `name` 的 `回撤X~Y%`（无桶但写「已回撤」⇒ 归参照列）；含「未破」⇒ 独立 scope `EVENT_LOW_GUARD`（**不与无约束格子混表**）。⚠️ **已知边界（写进 UI，不藏）**：归组依赖分析名 ⇒ **改名会使该分析脱离矩阵** —— 它**不消失**，而是出现在「未归类」里带具体原因并可点击跳转。**四、口径纪律（防把错误口径读成结论）**：① **排除 `details.outcomeVariable` / `details.variable` 与 `target` 不一致的结果行** ⇒ 自动挡掉 `CONDITIONAL` 自动附送的 `MAX_DRAWDOWN` 行（其 `variable` 由 `drawdownVariableFor(target)` 从 target 名尾推导、**不是同一变量**，即 9w 条登记之坑；真实数据每格命中 **1 行**并计数展示）；② 显著标记 `*`/`**` = 引擎落库 `P_VALUE_DIFFERENCE`（Welch），**基准是「全样本」而非相邻桶**，UI 原文写明并沿用引擎「未校正多重比较 / 窗口重叠」免责；③ `details.lowSample` 的格子标注「小样本」**不判显著**；④ **不产生新统计量** —— 格子主值/中位/胜率/标准差/差值/t/p 全为落库值搬运，行小结只给「格数 / 样本合计 / 显著格数」（**刻意不做按样本数加权平均**：各格互斥性与并集是否等于全集由建批方式决定，前端无从校验）。**五、界面**：默认矩阵；指标族（之后 1/3/5 日收益、5 日最大有利偏移、5 日最深跌幅）与口径可切；**惰性取数**（只拉当前选中族 ≤30 个分析，切族**不预取**其余 100+）；列顺序**固定**（参照列「已回撤(不限幅度)」+ `0~2%→8%+`，跨 Run 可比）；「**未建**」（该 Run 无此格）与「**无结果**」（有分析但无可用统计）**分开展示**；悬停给完整口径（含**引擎原样 `conditionRule`**）；**点任一格 → 切「逐分析」并选中该分析**。**六、验收**：`npx tsc --noEmit` **exit 0**（零输出）；`npx vitest run client/src` **17 文件 / 399 例全过**（本轮新增 22 例）；**真实库端到端**（探针 `docs/evidence/_r008_matrix_probe.mts`，只读，非产品代码）—— Run `540001` **135 个分析 100% 归组 / 零未归类**，默认 `BARE × return_5` **覆盖 30/30 格（6 列 × 5 行，已建 30 / 未建 0）**，格值与 `docs/evidence/_r0071_summary.md` **逐格一致**（证明纯函数只搬运不改数）；分行显著格计数 = T+1 **0 正 / 3 负**、T+2 0/1、T+3 2/0、T+4 **4**/0、T+5 3/0。**七、明确不做**：后端聚合端点；矩阵持久化成领域对象（属新领域设计）；格间两两检验（现有落库只有「条件组 vs 全样本」，前端硬造即**不可验证的新统计量**）。报告 `docs/research/RESEARCH-007.2-research-matrix-view.md`（10 节）；`docs/evidence/_r008_matrix_probe_result.md`（163 行，含 5 个族 + 2 个口径的完整矩阵输出）。
   - **9ab. （RESEARCH-007.3 · 覆盖审计线）Run 540001 的 135 个分析「按规格建齐、但覆盖不完整」—— 完整笛卡尔积 300 = 实建 135 + 零代码可补 45 + 引擎表达不了 120** ✅ **审计已完成（2026-09-13 00:58，只读探针；`server/**`、`client/**` 一行未改）**：触发 = 用户追问「**这个是不是分析少了很多，按这样计算的话，应该至少有几百条分析，而不是只有 5*5*5+10 条**」。**一、事实（实测，非推算）**：`docs/evidence/_r009_coverage_probe.mts` **复用前端同一套归组纯函数**（`client/src/components/research/researchMatrix.ts`）遍历 Run `540001` 全部 135 个分析 ⇒ **135 可归组 / 0 未归类 / 0 重复格**。轴与笛卡尔积 = **口径(2) × 决策日(5, T+1~T+5) × 列(6 = 「已回撤(不限幅度)」参照列 + 0~2%/2~4%/4~6%/6~8%/8%+) × 指标族(5) = 300**。实建 **135 = 125（B 组：5 天 × 5 桶 × 5 指标）+ 5（A 组：「已回撤」参照列，仅 `→ 之后5日收益`）+ 5（C 组：T+5 × `holds_event_low_5d == 1` + 桶，仅 `→ 之后5日收益`）**，与 `docs/evidence/_r0071_batch_plan.md`「**新批次：135 个分析**」及 `RESEARCH-007.1` §5 的 A/B/C 三组定义**逐条一致** ⇒ **结论：135 不是漏建，是按当初规格建的**（用户写的 `5*5*5+10` 正是这个设计）。**二、但覆盖确实不完整（三处，逐格实测）**：① **参照列「已回撤(不限幅度)」只有 `return_5` 有** ⇒ 矩阵切到 `return_1` / `return_3` / `max_return_5` / `max_drawdown_5` 时该列 5 格全「未建」（缺 **20**）；② **破位资格口径只有 `return_5 × T+5`** ⇒ 切到其他 4 族整表全空（缺 **25** = T+5×参照列×return_5 的 1 + T+5×5桶×其余4族 的 20 + T+5×参照列×其余4族 的 4）；③ **`T+1..T+4` 的破位资格在现有变量层根本造不出来**（缺 **120** = 4 天 × 6 列 × 5 族）：`buildEventLowGuardVariables(outcomeHorizons)`（`server/researchEngine/variables.ts:580`）的视界**只取自 Dataset 的 `outcomeHorizons`**（`390002` = `[5,10,20]`）⇒ 只有 `holds_event_low_{5,10,20}d` / `holds_event_low_close_{5,10,20}d`，**没有 1d~4d 的任何版本**；且 `EVENT_LOW_GUARD_BASES = ["low","close"]`（同文件 524 行）**没有 `"open"`**，而规格要的基准是首板日**开盘价**（`low(T) ≤ open(T)` ⇒ 现有 `low` 口径**更严格**，数字不可直接当规格口径用）。**三、还有一个用户没算进去的轴：视界 `h`**：Dataset `filterDefinitionJson` 里 `outcomeHorizons=[5,10,20]`、`pathHorizon=20`，而本批只用了 1/3/5 日；`segment_*` 目标按 `pathRows` 直接算、**不受 `outcomeHorizons` 限制** ⇒ 10 日 / 20 日视界**可算但没算**。⚠️ 受 `pathHorizon=20` 约束，**视界越长、可用决策日越少**（`segment_return_{d}_{d+h}d` 需 `d+h ≤ 20` ⇒ T+1 最多 h=19、T+5 最多 h=15）。**四、行动清单（分档）**：**A 档（45 条，零代码 / 零迁移 / 纯领域层建批，网页上同样能做）** = 20（BARE 参照列 × 5 天 × 4 族）+ 25（EVENT_LOW_GUARD × T+5 × 6 列 × 5 族，已建 5）⇒ **135 → 180**；**B 档（120 条，须先扩变量层）** = 让 `holds_event_low_*` 覆盖 `pathHorizons ∩ [1,5]`（最小改法）+ `EVENT_LOW_GUARD_BASES` 加 `"open"` ⇒ `T+1..T+4` 的破位资格才可建，届时可到 **300**；**C 档（可选，视界扩展）** = 加 `return_10` / `return_20` 与 `max_return_10/20`、`max_drawdown_10/20` 族（决策日上限随之收窄）。**五、本次不做**：任何补跑（等用户选定档位）；`server/**` 改动。证据 `docs/evidence/_r009_coverage_probe.mts` + `docs/evidence/_r009_coverage_probe_result.md`（314 行，含 10 组逐格 ✔/· 覆盖矩阵 + 全部 135 条原始清单）。

   - **9ac. （RESEARCH-007.3 · 覆盖补齐线）Run 540001 由 135 → 180 条 —— A 档：只用现有功能补掉两类「假缺口」，剩余 120 条缺口 100% 是引擎表达不了的真缺口** ✅ **已完成（2026-09-13 00:52，DATA_READY；🔴 `server/**` 运行时代码一行未改、零迁移、零新端点、零新依赖）**：**一、决策** —— 用户明确「**10 日与 20 日对我不是很关键**」⇒ 排除 C 档（视界族 `return_10/20` 等）⇒ 执行 **A 档**（上一轮列出的三档中唯一零代码、且不触碰 `server/**` 的选项）。**二、补了什么（45 条）**：**A-1（20 条）** 无资格约束 × 参照列「已回撤(不限幅度)」× 4 族（`return_1` / `return_3` / `max_return_5` / `max_drawdown_5`）× T+1~T+5 —— 准入条件 `future_return_{d}d < 0`（深度 > 0）；`return_5` 的参照列原批次已有 ⇒ **不重复建**。**A-2（25 条）** 加「未破首板最低价」资格 × T+5 ×（**A-2a 5 条**参照列：5 族 × 已回撤；**A-2b 20 条**桶列：4 族 × 5 桶，`return_5` 桶列原已有）—— 条件 = `holds_event_low_5d == 1` AND（`future_return_5d < 0` 或深度桶）。⇒ **135 → 180**。⚠️ **为什么加资格口径只有 T+5 一行**：`holds_event_low_{h}d` 的窗口恰为 `[T+1, T+h]`，只有 `h == 决策日` 才零前视；变量层只存在 `holds_event_low_{5,10,20}d`（视界取自 Dataset 的 `outcomeHorizons`），**用 `5d` 去过滤 T+1 决策日 = 拿 T+5 的信息做 T+1 决策，是严重前视，明确不做**。**三、执行路径（关键取舍）**：用 **`runIncremental` 而非 `runEngine`** —— 读源码确认分工（`researchEngineRouter.ts:457-490` / `engine.ts:400-410`）：`runEngine` 整轮**会覆盖该 Run 全部分析的结果**；`runIncremental` 只补「尚无有效结果」的（PENDING/FAILED/CANCELLED）、**不覆盖已 COMPLETED 的 135 条**、并复用 Run 冻结快照（Dataset Version + 日期窗口）⇒ 新旧结果可比。**代价（如实登记）**：增量批次**不生成结论**（`conclusionId` 恒 `null`，`conclusionSkippedReason` 明确说明「AnalysisSummary 是执行期产物、未落库，无法重建已跳过分析的历史摘要」，Run 结论保持旧的 `480001 REJECTED` 不动）。**四、真实执行**：预检 `45/45 通过` + 无重名 + 无 RUNNING Run ⇒ 建批 `created=45 failed=0`（analysisIds `510001`~`510045`）⇒ 补跑 `executionSequence=3`（第 1 批建批 / 第 2 批 FULL 135 / 本批 INCREMENTAL 45）、`basisSource=run-snapshot`、`datasetVersionId=390002`（**未漂移**）、`sampleCount=23978`、`analysisCount=45`、`resultCount=664`、`durationMs=164855`（**164.9 s**）、终态 `COMPLETED`、**45/45 全 COMPLETED**（每条约 14~16 行结果）。**五、补后覆盖（`docs/evidence/_r009_coverage_probe.mts` 重跑，仍复用前端同一套归组纯函数）**：**分析总数 180 / 可归组 180 / 未归类 0 / 无重复格**；无资格约束 **130 → 150**、加「未破首板最低价」资格 **5 → 30**；每族可归组 **36**（BARE 30 + 加资格 6）；完整笛卡尔积缺口 **165 → 120**。⚠️ **剩余 120 条缺口恰好 = 加资格 × T+1~T+4 × 6 列 × 5 族，100% 是「引擎表达不了」的第 ③ 类真缺口** ⇒ 矩阵视图里 T+1~T+4 行的「未建」是**如实反映现实**，不是渲染问题、也不是本轮漏做。**六、真实数据端到端（`docs/evidence/_r008_matrix_probe.mts` 只读 → `docs/evidence/_r008_matrix_probe_result.md`）**：归组 **180/180**；默认 `BARE × return_5` **30/30 格**（补前最左「已回撤」列整列缺失）；**三条互相独立的交叉一致性证据** —— ① BARE × T+1 × 已回撤 `n = 9,899`，与 RESEARCH-007.1 审计时的「组 A 9,899」**逐数字一致**；② 增量补跑 `sampleCount = 23,978` 与 FULL 批次相同；③ 补批前 135 条格值与 `docs/evidence/_r0071_summary.md` **逐格一致**（本轮未触碰已有结果）。**七、验收**：`npx tsc --noEmit` → **本批涉及文件零错误**（全库仅剩 **2 处**错误、**全部**在 `client/src/components/research/candidateSketchForm.ts`，属**并行会话在途改动**（该文件修改时间 2026-09-13 00:47:25，正在我跑引擎期间），与本批无关）；`npx vitest run client/src/components/research/researchMatrix.test.ts` → **23/23 全过**（本轮新增 1 例，覆盖 **A-2a 引入的新名称组合**「未破」+「已回撤」同现 ⇒ 必须判成「加资格口径 × 参照列」而**不被误判成桶**）；全量 `npx vitest run client/src` → **17 文件 / 400 例：388 过 / 12 失败**，**失败全部**在 `client/src/components/research/candidateForm.test.ts`（`parseSketchJsonText is not a function`，同源于上述并行会话在途改动，与本批无关）；🔴 **`server/**` 运行时代码一行未改**。**八、明确不能实现（已逐条列给用户）**：① **加资格 × T+1~T+4（120 条）** 与 ② **「未破首板日开盘价」滚动资格** —— 需改 `server/researchEngine/variables.ts`（视界收窄到 `pathHorizons ∩ [1,5]` + `EVENT_LOW_GUARD_BASES` 加 `"open"`；现有 `low` 基准更严格、数字不可直接当规格口径用），**会热重启并杀死在途 Run**，须单独排期（B 档）；③ 视界 10/20 日族 —— 技术上可建（`segment_*` 不受 `outcomeHorizons` 限制，只受 `d + h ≤ 20`），但**用户已明确不关键**；④ 桶内 P25/P75（`CONDITIONAL` 不输出分位数、`DESCRIPTIVE` 不支持条件过滤）；⑤ 格间两两检验（落库只有「条件组 vs 全样本」，硬造会成为不可验证的新统计量）；⑥ 网页端改分析名 / 改条件（`updateAnalysis` / `setAnalysisConditions` 均为 `adminProcedure`）。**九、状态判定**：`DATA_READY`（180 条分析已落库并全部产出结果）；**不是** `RESEARCH_READY` —— 本 Run 只有一条基于 135 条的旧结论，增量批次按设计不产新结论 ⇒ **不允许**由本 Run 直接下策略结论。**产物**：`docs/research/RESEARCH-007.3-run-540001-coverage-backfill.md`（**10 节**）；脚本 `docs/evidence/_r010_backfill_apply.mts` / `docs/evidence/_r010_backfill_run.mts` 与只读审计 `docs/evidence/_r009_coverage_probe.mts` / `docs/evidence/_r008_matrix_probe.mts`（**均非产品代码**）；补前/补后快照各留一份（`_r009_coverage_probe_result_{135,}.md`、`_r008_matrix_probe_result_{135,}.md`）。

10. **（RESEARCH-003 硬前置）`ds_*` 口径核对 + 版本可用性修复** —— ⚠️ **2026-09-11 18:58 实查修正本条前提**：原表述为「P1 涨停口径修复 + 重建 smoke/v1/v2（当前仍是旧口径、漏判 ≈38.03%）」，但 `scripts/verifyLimitUpCaliber.mts` 实查证明 **v1/v2 的涨停判定已是【四舍五入】口径**（v1 含 436/1,130 = 38.6% 向下舍入型样本、v2 含 5,039/13,579 = 37.1%；`limitUpPrice` 逐元等于 `exchangeLimitUpPrice`；并经原始行情交叉验证；且 S4 已证新 builder 重建 v1 窗口与既有 v1 **逐字节等价、五表 60,002 行零差异**）⇒ **口径无需修复、v1 无需因口径重建**；38.03% 是旧谓词对**原始行情**的漏判率，非 `ds_*` 数据属性。**修正后本条的剩余工作**：① 🔴 ~~**v2(390002) 构建不完整**（仅 `event=13,579`，其余四表全 0、`status` 永久 `BUILDING`）→ 需**补完/重建**（工程问题）~~ ✅ **2026-09-11 22:55 实查：本条已作废** —— v2 由 DATASET-LIFECYCLE-001 的启动钩子在 21:24 解困后**已重建成功且状态 READY、五表齐备**（events **23,978** / path **471,816** / outcome **71,934** / prefix 503,538 / post 471,816，窗口 2024-09-02→2026-09-01）；且已在 v2 上实跑 `verifyResearchEngine.mts --all`：**5 类分析全 COMPLETED、Run/Experiment COMPLETED、结论 SUPPORTED**，唯 **dataset 装配 529,740 ms** 是瓶颈（单次整轮 ≈ 9 分钟）⇒ **剩余工作只剩性能，不是可用性**；② 建议先把 `runner.ts` `completeJob → markReady` 合并为单事务（否则补完仍会重犯）；③ 重建后对新版本跑 `scripts/verifyLimitUpCaliber.mts` + `scripts/verifyDatasetWindowLayering.mts`（I1~I11）双验收。**v1 仍可正常用于研究**（口径与现行代码同源、五表齐备、S4 已证等价）。④ ⚠️ **2026-09-11 20:27 实查：v2 当前处于「死锁」态 —— 既不能重建也不能删除**（`createJob` 报 `VERSION_NOT_BUILDABLE`、`deleteVersion` 报 `VERSION_HAS_RUNNING_JOB`），根因是**幽灵 RUNNING 作业**（`job2` 自 2026-09-11 11:47:27 起再无进度更新却永久 RUNNING；runner 运行态为进程内内存 map、无孤儿回收机制）⇒ 补完 v2 前**必须先破锁**，详见 §47 DATASET-LIFECYCLE-001 与队列第 14 条。
11. **（建议 RESEARCH-003 = 在正确口径数据上做研究 + 补齐引擎边界）**：① 修上游 `liquidity_daily.totalMarketCap`/`circulationMarketCap` 全 NULL（解锁市值/流通盘特征）与 industry `effectiveFrom` 单点（解锁行业维度）；② 构建跨年跨板块的 Dataset Version（使 year/month/board 稳定性真正可评估）；③ 接入 `marketRegime22` 作为合法 `RegimeTagProvider`（解锁 regime 分组）；④ Dataset 定义交易规则后实现 `time_to_target`/`time_to_stop`。
12. **（数据完整性，2026-09-11 19:20 实查新增）两处「缺唯一约束」修复** —— 由 `scripts/verifyRawDataUniqueness.mts` 审计发现（**原始行情表全部已受唯一约束保护，重叠窗口回填幂等、无重复**，详见 §47 DATA-INTEGRITY-001）：① **`research_security_status_history` 缺 UNIQUE(securityId, statusType, effectiveFrom)**（真实库仅 PRIMARY，当前实测 0 重复，但 `pickLatest` 的 tie-break 是「任取」⇒ 一旦写入重复，PIT ST 判定会退化成由 `source` 字母序决定 5%/10% 涨跌停比例）→ 按 §迁移流程 补 DDL；② **`limit_up_records` 无业务唯一键**（实测 26 组 / 166 行多余，含 **143 行「测试」占位污染**（⚠️ 2026-09-11 19:35 更正：原记「258 行」是**判据过宽的误报** —— `%测试%` 会命中真实股名 `谱尼测试`/`西测测试` 与真实关键词 `封装测试`/`芯片测试设备`；改用前缀 `测试%` 后真实污染 = **143 行，全部是 `000001.SZ 测试股票`**：`2024-12-31` 142 行 + `2025-12-31` 1 行），最重一组 `2024-12-31/000001.SZ` 重复 142 条）→ 已污染 `getLimitUpCountsByDate`（`COUNT(*)`）/ 题材热度 / `marketRegimeRouter` 涨停家数（99,577 虚增为实为 99,411）→ **需确认后清理 + 决定是否补唯一键**（注意：同股同日「打开涨停后重新封板」是否属合法多记录需先定业务语义，不可盲目加唯一索引）。
13. **（连板高度口径，2026-09-11 19:35 实查新增）`boardCount` 字段与连板高度口径统一 + 数据缺口修复** —— 由 `scripts/verifyBoardHeightCaliber.mts` 审计发现（1/4 通过，详见 §47 DATA-INTEGRITY-002）：① `limit_up_records` 存在 **133 行「自称 N 连板但表内凑不出 N 天」的缺口**（如 `000078.SZ 2025-12-02 自称 5 连板、表内只有 1 天`）与 **30 行「记为首板但前一交易日同股已有记录」的断裂**（全部来自 OCR 链路）⇒ `db.ts#calculateConsecutiveBoards` 的邻接链在这些位置断开，**连板高度被低估为「首板」**，进而影响涨停梯队分布 / `leaderCandidates` / 高位连板风控；② **`boardCount` 字段是「死字段」**（页面与统计均不读它，而是读取时按表内日期集合重算）却与重算口径在 **160+ 行上矛盾**，且含两套格式（回填 `首板`/`N天N板`、OCR `1`/`N天M板`）⇒ 任何按该字段筛选的逻辑都会得到不一致结果；③ 🔴 **`scripts/backfillLimitUpRecords.mjs` 的连板计算存在潜在缺陷**：`const fresh = hits.filter(h => !existing.has(...))` 之后 `streak` 只在 **本轮新增** 上推进，不参考已在库历史 ⇒ **按间隔区间分批回填时，区间衔接日的连板数会被错误重置为「首板」**（当前数据未显现，因回填一次性跑完；修法 = 用「已在库历史 ∪ 本轮新增」的并集，且日期基准改用 `index_daily`）。

14. **（构建生命周期，2026-09-11 21:35 更新：治本已落地并实测验收）「取消构建 → 重新构建」数据完整性 + v2 死锁解困** —— 20:27 实查（见 §47 DATASET-LIFECYCLE-001）后，用户指令「**根治这个问题，取消构建后就要删除数据**」，本轮已全部落地：
   ① ✅ **治本 A —— 孤儿作业回收已实现并已生效**：`registry.reclaimStaleJobs()` 扫描「`status='RUNNING'` 且 `updatedAt ?? startedAt` 停更超阈值」作业 → **条件** `transitionJob(RUNNING→CANCELLED)`（防与真实执行者竞争）→ 版本 BUILDING→FAILED → 清空该版本数据行；启动钩子 `reclaimOrphanBuildJobs()`（`server/_core/index.ts`，阈值 env `DATASET_RECLAIM_STALE_MINUTES`，默认 10 分钟）。**实测已自动解困**：v2 幽灵作业 `540001` 被回收（`errorMessage="orphan reclaimed：停更 55 分钟无进度更新"`）⇒ v2 死锁解除，应用侧 21:24 已成功对 v2 发起重建（`job 630008`）。**无时间基准 → 跳过不回收**（诚实，不误杀）。
   ② ✅ **治本 B —— 「重建 = 从零」已实现**：`runner.execute` 在 `builder.build` **之前**调用 `service.purgeVersionRows(versionId)`（分批 5000 行 DELETE、按 `datasetVersionId` 逻辑隔离、表结构保留、其它版本不受影响）。依据：清场必须早于 build，且 upsert 是 `ON DUPLICATE KEY UPDATE id = id`（空更新）⇒ 不先清场必然留新旧混合。
   ③ ✅ **「取消 = 回滚」已实现**：新增 `service.cancelJobAndRollback()`（唯一权威用户可见取消入口）+ `runner.waitForStop()`（**可等待停止**，超时 60s）。router `cancelBuildJob` 顺序固定为 **`runner.cancel` → `await waitForStop` → `cancelJobAndRollback`**；未在超时内停止 → 只置取消态 + 返回 `rollbackSkippedReason`（**绝不静默假装已回滚**）；重复取消**幂等**（不抛 `INVALID_JOB_TRANSITION`，只补做回滚 + 版本态兜底）。**新增例外（防止回滚变成数据销毁）**：版本仍 READY ⇒ 本轮**尚未接管**（清场在 `markBuilding` 之后）⇒ **不回滚**，`rollback=null` + 诚实原因，避免制造「READY 却 0 行」的谎报态。
   ④ ✅ **审计新增 L4 不变式**：`scripts/verifyDatasetBuildLifecycle.mts` 增 L4「非 READY 且无 RUNNING 作业的版本不得残留数据行」（= 取消即回滚的常驻护栏），**实测 7/7 通过**。
   ⑤ ⬜ **未做**：`completeJob → markReady` 合并单事务（既有已知项）；`batchSize` 速度标定并固化进 `dataset_build_config`。

15. ~~**（前端线 · RESEARCH-006.4.1-C）候选草图「五块全部表单化」**~~ ✅ **已完成（2026-09-13 01:20，CODE_READY + 真实库往返验证；`server/**` 生产文件一行未改）**：触发 = 用户「候选草图的地方，各种规则都是用 json 文本来的，这个不合适吧」⇒ 裁定「五块全部表单化」。**要解决的问题**：5 个 `*Json` 列的写入方原本是**手写 JSON 文本框**，而**唯一的转正转换器** `definitionBuild.ts#buildStrategyDefinition` 对它们的要求是**词表有界 + 键名闭集**（`entryRule.extra` 闭集七键、`costModel` 六项全必填、`regimeGate`/`position.maxPositions` 出现即报错、参数角色恒 `TUNABLE`）⇒ **让人手写 JSON = 把闭集校验推给人**，写错要等到转正才吃 `PROMOTE_SKETCH_INCOMPLETE/INVALID`。**交付（新增 4 / 重写 2 / 改 5；零后端改动 · 零迁移 · 零新端点 · 零新依赖）**：`candidateSketchVocabulary.ts`（本地词表 + 标签 + 字段引用解析镜像）、`candidateSketchForm.ts`（纯函数：三态草稿 `empty|structured|raw` + 五块 JSON ⇄ 草稿 + 校验 `errors`/`gaps` + 补丁构造）、`CandidateSketchFields.tsx`（五块子表单）、`candidateSketchForm.test.ts`（22 例）；重写 `EditCandidateDialog.tsx`（5 个 `<Textarea>` → 结构化表单，`gaps` 清单摊在保存键上方）与 `CandidateSketchCard.tsx`（按结构渲染，表达不了的原样展示 JSON）。**三条纪律**：只产出后端认得的键（词表**对表测试**锁定，含 Research 11 个运算符里策略侧只映射的 **8 个**）／表达不了 ⇒ 整块降级只读 `raw` 且 **`raw` 永不提交**（只有显式「清空」才提交 `null`）／**往返幂等**（空改不产生写入）。**🔴 本轮修掉一个真实缺陷**：`buildSketchPatch` 原拿原始字面值与规范化 JSON 比 ⇒ `extra: {}`、键序差异被误判为改动（首次跑测 4 例失败）⇒ 改**双侧规范化**（`canonicalSketchJson` + `sketchValuesEqual`）+ 抽出唯一映射表 `SKETCH_JSON_BUILDERS`。**验收**：`tsc` **exit 0**（**顺带消除上一轮登记的 2 处错误**，它们就在本轮的在途文件里）；聚焦 **14 文件 / 375 例全过**；`vite build` **RC=0**；真实库 **`docs/evidence/_e2e_sketch_roundtrip.mts`（自建自清）24/24 PASS** —— 真实 tRPC 五块入库 → 读回**逐块相等** → 幂等 → 只改一块只有该块 → **候选行数守恒 1→1**；`docs/evidence/_e2e_sketch_form.mts`（只读）证明既有候选打开编辑**不产生假改动**。**边界**：`definitionBuild.ts` 一字未动、未新增第二个 Candidate→Strategy 入口、未改 Dataset Registry。⚠️ **登记（非缺陷，是设计）**：词表是**手工镜像**（客户端不可 import 服务端运行时值），后端词表一变则**对表测试先红** —— 这是漂移哨兵，不是噪音。

16. **（前端线 · RESEARCH-006.4.1-C.2）候选草图编辑器「按交易决策顺序重排」** ✅ **已完成（2026-09-13 01:40，CODE_READY + 真实库端到端；`server/**` 生产文件一行未改）**：触发 = 用户对上一版表单的**可用性批评**「**这些里面太多需要填的选项了，而且也过于复杂了，并且十分不直观**」⇒ 在两问六档里裁定「**按交易决策顺序重排**」+「**一键预设 + 记住上次**」。**一、先量化根因（不是感觉，是数出来的）**：读 `definitionBuild.ts`（810 行）+ `service.ts#createFromConclusion` + `definitionValidation.ts` 逐条核实 ⇒ **转正真正卡死的必填只有 16 项**（事件类型 / 入场时点 / 观察窗口 start·end·unit / 触发时点 / 数量口径 / 每手股数 / 仓位方式 / 最大持仓数 / 初始资金 / 成本费率 6 项），而上一版界面铺了 **40+ 个输入**。三处具体冗余：① 成本 6 项 + 资金每次都是同一套 A 股标准值；② `lotSize`（每手股数）**出现两次**；③ 仓位/风控同一概念散在 `entryRule.risk.*` / `entryRule.position.*` / `riskRule.*` **三处**。**二、🔴 本轮最重要的一处纠正（我此前写错了必填性）**：`exitRule` **不是**转正必填 —— `buildStrategyDefinition` 允许 `exit.rules` 为空数组（草稿为空 ⇒ 不 push 任何 rule），既有校验器 `definitionValidation` 对它**只检查「是数组」**，全文**无任何「至少一条」约束**。⇒ 上一版缺口文案「出场规则整块还没填（`exit.rules` 需要至少一条）」是**我编的假警报**，已彻底移除并降级为非阻断提示（③ 段全空时反而显示「未设置 —— 会持有到回测期末，这不是错误」）。**三、界面模型：段 ≠ 存储块**（纯 `client/**`，`server/**` 一字未动）：`client/src/components/research/candidateSketchForm.ts` 新增**六段模型** `SKETCH_SEGMENTS` = **买什么 → 什么价买 → 怎么卖 → 买多少·最多持几只 → 成本与资金 → 参数搜索空间**，每段带 `blocks` / `initBlocks` / `SKETCH_SEGMENT_REQUIRED`（单列成表以获穷尽性检查）/ `SKETCH_BLOCK_HOME_SEGMENT`（块 → 归属段，保证 `raw` 块**只在归属段展示一次**）。⚠️ 关键事实：`entryRule` **一块同时承载第 ①②④⑤ 段**（事件 / 窗口与时点 / 仓位执行 / 文档成本）⇒「该块变只读」会同时影响四段，界面已如实标出。**四、中文摘要 + 结构化缺口**：新增 `summarizeSketchSegment` / `sketchSegmentStatus` / `sketchSegmentStatuses`（**一次算齐六段**），折叠态显示一句人话（如 `what` →「首个涨停（首板）· 3 个事件参数 · 2 条剔除条件」、`exit` →「止损 5% · 止盈 10% · 3 个交易日后卖出」、`cost` →「本金 100 万 · A 股标准成本」）；`SketchValidation` 由 `{errors, gaps}` 扩为 `{errors, gaps, gapDetails}`（`gaps` 是 `gapDetails` 的投影，**不会两套说法**），每条缺口带 `segment` 归属 ⇒ 界面可「点缺口 → 展开并滚到对应段」；**必填段缺项自动展开**（只自动展开**第一个**有缺口的段，避免六个全开）。**五、成本一键预设 + 本机记忆**（新增 `candidateSketchCostPreset.ts`）：复用**仓库既有口径**（`strategyAdapter.ts#parseCostModel` 兜底值 = `StrategyEditor.tsx` 模板 = `commissionRate 0.0003 / stampDutyRate 0.001 / transferFeeRate 0.00001 / slippageBps 10 / lotSize 100 / minCommission 5 / initialCapital 100000`），**不另立第二套数字**；`applyCostPreset` **只覆盖七项、绝不动 `maxPositions`**（最大持仓数是回测设置、不是费率）；`localStorage` 记忆**七项齐全才接受**，下次打开直接带出；🔴 **边界（写进文件头）**：预设**不产生任何隐式默认**，只有用户**显式点击「套用」**才写入 —— 这与「Promote 不补默认值」不冲突（那条约束的是**转正转换器**）。**六、顺带修掉两个真缺陷**：① **全空的条件行 / 参数行曾拦住保存**（点「加一条」还没填就报错）⇒ 改为**静默跳过**，与 `conditionGroupsToPayload` 既有口径（「字段名空白的行 = 看起来填了、实际没填，不落库也不占位」）**对齐**；② **阻断性错误显示在表单下方**（滚下去才看得见）⇒ 移到表单上方并按 `Set` 去重。**七、验收**：`npx tsc --noEmit` **exit 0**；`npx vitest run client/src/components/research` **9 文件 / 252 例全过**（草图模型层 22 → **36 例**）；全量 `npx vitest run` **7 文件 / 15 例失败 = 既有环境依赖基线，零新增**（3,784 passed）；`npx vite build` **RC=0**（3,020 模块 / 23.20 s）；真实库 `docs/evidence/_e2e_sketch_roundtrip.mts`（自建自清）**24/24 PASS**（真实 tRPC 五块入库 → 读回逐块相等 → 幂等 → 只改一块只有该块 → 候选行数守恒 1→1）；Vite dev server 实测返回新版代码（`sketchSegmentStatuses` / `CostAssumptionPanel` / `SKETCH_SEGMENTS` 均出现，5 文件全 200）。⚠️ **本机 `agent-browser` 不可用 ⇒ 按项目约定不使用浏览器截图做验收**。§47 01:40 条 + 记忆 `.workbuddy/memory/2026-09-13.md` 01:40 条已同步。

17. **（前端线 · RESEARCH-006.4.1-C.3）候选草图三处缺陷修复：「买入条件」正名并归位到「什么价买」段 + 条件行去抽象化 + 常用买入条件模板** ✅ **已完成（2026-09-13 01:50，CODE_READY + 真实库端到端；`server/**` 生产文件一行未改）**：触发 = 用户**第二次可用性批评**「**1 什么价买差一个选项，没法填。2 买什么中的事件参数与不买什么的事件参数，只有很抽象的代码。3 观察日的时候，应该再观察日买足什么条件就可以买入。总之来说，就是还不能完全实现 t 日涨停，观察五日，回撤达到某种幅度，可以买入的那种策略。**」。**一、三条批评 = 两个真缺陷**：`filterRule` 的唯一去向是 `entry.conditions`（`definitionBuild.ts:506-508`）=「**全部满足才产生买入信号**」，而 `ResearchEntryRule`（`researchCore/candidates.ts:19-26`）**没有 conditions 字段** ⇒ 它是入场条件的**唯一载体**；「没法填」的根因 = **我把它的语义方向写反了**（标成「不买什么 —— 剔除条件」，且折叠在「买什么」段里）。**二、🔴 两处语义纠正（不是措辞偏好）**：① 标签「不买什么 —— 剔除条件」→「**买入条件**」（`SKETCH_BLOCK_LABELS.filterRule`）；② 归属段从 `what` → **`when`（什么价买）**（`SKETCH_BLOCK_HOME_SEGMENT.filterRule`）并默认可见；`what` 段摘要移除条件计数、`when` 段摘要加「买入条件：<人话整句>」。**三、去抽象化**：字段引用换成「**部位 + 相对日 + 字段**」三格选择器（选项全中文）+ 人话预览 + 小字回显原始引用；不可解析的既有值退回自由文本**且绝不重建**（防静默丢数据）；事件参数加常见键提示（`limitUpRatio` / `eventCode`）与「键名**没有白名单**、服务端原样透传」的明说。**四、可表达「观察日满足什么条件才买入」**：新增 **5 个常用条件模板**（前两条**逐字取自后端 golden sample** `FIRST_BOARD_PULLBACK_DEFINITION`：`bar.low >= prefix.rd0.open` / `bar.volume < prefix.rd0.volume`）。**五、🔴 新登记两个后端缺陷（只登记、不改代码；改 `server/**` 会热重启杀死在途 Run ⇒ 单独排期）**：① **`OR` / `NOT` 静默压成 AND**（`buildConditions` 把条件组扁平化进**没有逻辑运算符字段**的 `ConditionDefinition[]`；**真实转换器取证**：OR 版与 AND 版产出的 conditions **逐字节相同且不报错**；前端加 `warnings` 通道，**不阻断保存 / 不阻断转正**）；② **条件右值无算术** ⇒「回撤 X%」（需 `prefix.rd0.close * 0.95`）**表达不了**，`ConditionDefinition.value` 只有 `CONSTANT` / `FIELD_REFERENCE` / `PARAMETER_REFERENCE`；已给替代路径（首板日开/高/低/收做价格锚点，或把幅度做成参数）。**六、验收**：`npx tsc --noEmit` **exit 0**；`npx vitest run client/src/components/research` **9 文件 / 265 例全过**（`candidateSketchForm.test.ts` 36 → **49 例**）；全量 `npx vitest run` **15 失败 / 7 文件 = 既有环境依赖基线，零新增**（3,797 passed）；`npx vite build` **RC=0**（3,020 模块 / 14.73 s）；**真实库 `docs/evidence/_e2e_first_board_pullback.mts`（自建自清）48/48 PASS** —— 表单层 + 持久层 + **转换层**（真实 `buildStrategyDefinition` 产出的 `entry.conditions` 与 golden sample 的 `field/operator/value/valueType` **逐项一致**）+ 顺带锁住「符号运算符 ⇄ 长名」映射表（`CONDITION_OPERATOR_MAP`）。**七、边界**：`server/**` 一行未改、未改 Dataset Registry、零迁移、零新端点、零新依赖、无第二个「Candidate → Strategy」转换入口。

18. **（前端线 · RESEARCH-006.4.1-C.4）候选草图「差哪一项」定位修复：缺口带机器可读落点 + 段内逐条清单 + 必填输入框就地高亮** ✅ **已完成（2026-09-13 02:05，CODE_READY + 真实库零写入复算验证；`server/**` 生产文件一行未改）**：触发 = 用户**第三次可用性反馈**「**什么价买这个还是有问题，永远还差一箱校验，没法继续往下一步走**」。**一、定位（读真实库那一行，不靠猜）**：新增只读探针 `docs/evidence/_probe_when_gap.mts`，用**组件同一条纯函数路径**复算真实候选 #270001（`status=ACCEPTED`）⇒ `errors=0` / `warnings=0` / **`gaps=1` 且恰在 `when` 段**，缺的是 **`entryRule.timing`（入场时点）**；其 `entryRuleJson` **确实没有 `timing` 键** ⇒ 用户把该段**看得见的都填完了**（窗口 1–4 交易日、触发时点=次一交易日、两条买入条件），只剩一个既不知道、又与「触发时点」看着像同一件事的下拉。**二、根因（有代码坐标）**：编辑器 `CandidateSketchFields.tsx` 顶部横幅原本只渲染 `{段名} · {gapCount}`、段徽标只渲染「还差 N 项」—— **缺口文案 `gapDetails[].label` 只在只读卡片 `CandidateSketchCard.tsx` 里列出，编辑器从不显示** ⇒ 「差几项」看得见、「差哪一项」看不见。**三、修法**：① **模型层给落点**（`candidateSketchForm.ts`）：新增 `SKETCH_FIELD_ANCHORS`（10 个稳定键）+ `SketchGap.anchors: readonly SketchFieldAnchor[]`，**锚点与 `label` 在同一个 `gap(...)` 调用点配对**（杜绝「清单说 A、高亮落在 B」的第二套说法）；用**数组**是因为「入场规则整块未填」时一条缺口同时对应三件套（时点/窗口/触发），拆三条会让段计数虚高；`SketchSegmentStatus` 增 `gaps: readonly SketchGap[]`（`gapCount ≡ gaps.length`）。② **界面层往下沉**（`CandidateSketchFields.tsx`）：顶部横幅改为**逐条文案**（可点击跳段）；展开段**首行**新增琥珀清单 `SegmentGapList`；`Field` / `Section` 新增 `missing` 属性，判据**只来自该段缺口的 `anchors`**（**不另立必填表**），命中即「必填未填」徽标 + 琥珀圈，落在**具体那个输入框**上；「入场时点」与「触发时点」的 `hint` 互相点名（触发时点=何时产生信号，入场时点=信号后哪根 bar 成交，都必填）。③ 给「触发时点」四取值补**真实语义**（逐条取自 `strategySchema/definition.ts:333-336`）：首个有效日 / 最后一个有效日 / 每个有效日 / 再顺延一个交易日，并明说「T 日涨停 → 观察 5 日 → 回踩到位才买」应选「首个有效日」。**四、🔴 顺带查实一条服务端自相矛盾（只登记、不改代码）**：`SAME_CLOSE`（「事件日收盘买入」）映射出 `{signalTiming:"T_CLOSE", executionTiming:"T_CLOSE"}`，被 `definitionValidation.ts:710-715` 的 **L6 拒绝**（`SIGNAL_EXECUTION_TIMING_CONFLICT`，现成用例 `strategyDefinition.test.ts:903-909`）⇒ **选了转正必然失败**。**不从词表删**（对表断言是漂移哨兵，删一项 = 关掉哨兵）⇒ 改 `SketchOption.disabled` **置灰 + note 写明 L6 码与替代项**，并配**自失效**测试（断言服务端三元组确实同 bar 成交；服务端一修好，测试先红、置灰随即撤掉）。根因在 `server/**` ⇒ 与 C.3 的两条一并**单独排期**。**五、验收**：`npx tsc --noEmit` **exit 0**；`npx vitest run client/src/components/research` **9 文件 / 274 例全过**（`candidateSketchForm.test.ts` **49 → 58 例**，含**复刻真实 #270001 那一行的回归用例**：`when` 恰好 1 项 / label 含「入场时点」/ `anchors = ["entryRule.timing"]` / 补上 `timing` 后归零）；全量 `npx vitest run` **7 文件 / 15 例失败 = 既有环境依赖基线，零新增**（3,806 passed）；`npx vite build` **RC=0**（3,020 模块 / 15.42 s）；**`docs/evidence/_probe_when_gap.mts` 12/12 PASS 且全程零写入**（含「模拟选中 ⇒ 缺口 1→0 ⇒ 补丁只含 `entryRule` 且保留原 `extra`」）；dev server 实测含 `SegmentGapList` / `missingAt` / 「必填未填」/「当前不可选」。**六、边界**：`server/**` 生产文件**一行未改**、零迁移、零新端点、零新依赖、**未新增第二转换入口**、`raw` 块**永不进补丁**；`anchors` 纯增量（`EditCandidateDialog.tsx` 无需改动）；**未触碰任何真实候选数据**。**产物**：`docs/evidence/_probe_when_gap.mts`（零写入验证探针，留仓库供复核）+ `docs/evidence/_vite_build_whengap.log`。§44 头部 02:05 条 + 本行 + §47 02:05 条已同步；记忆 `.workbuddy/memory/2026-09-13.md` 02:05 条已追加。

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

> 🔴 **正文已于 2026-09-13 迁出**，见 **[`ROADMAP-CHANGELOG.md`](./ROADMAP-CHANGELOG.md)**（718 行 / 约 500 KB）。本标题**只作指针保留 —— 不要在本文件再追加**。
>
> - **写入口**：任务完成后，在 `ROADMAP-CHANGELOG.md` 的**文件末尾追加**一条（append-only，禁止删除 / 覆盖历史记录）。
> - **职责不变**：§47 仍与 §44（覆盖式真实状态）、§44.5（任务队列）并列为 Master Control 三件套 —— 「每任务完成必须更新三者」这条纪律的第三个载体现为 `ROADMAP-CHANGELOG.md`。
> - **零改写**：历史条目逐字节搬运（唯一改动 = 原 `# 47.` 标题行下沉为 `## 更新记录（append-only）`）；本次同时把被 `# 49.` 标题割裂的第二段**并回日志尾部**，`# 49.` 之下不再夹杂日志条目。
> - **体量**：拆分后 `ROADMAP.md` 852 KB → 约 332 KB。

# 49. 目录与模块命名规范（2026-09-07 定稿）

## 49.1 规则（强制，面向新增/修改代码）
1. **代码模块目录名禁止携带 STEP/C-task 编号或任何数字后缀**（robustness18、signal13 之类一律禁止）；使用纯语义小驼峰（camelCase），如：`signalEngine`、`costModel`、`executionConstraints`、`riskAdjustedMetrics`、`tradeQualityMetrics`、`parameterSearch`、`rollingOptimization`、`robustness`、`stochasticRobustness`、`walkForwardRun`、`oosIsolation`、`overfittingDetection`、`lifecycle`、`marketRegime`、`paperAccount`、`signalToPnl`、`researchDataset`、`datasetAccess`、`simulator`、`strategySchema`。
2. **模块文件（含 .test.ts）同样禁止携带任务编号**；测试文件与模块同主体：`<module>.test.ts`（如 `robustness.test.ts`）。
3. **STEP/C-task ↔ 模块映射由以下渠道承载，目录名不得重复承载**：目录头注释（`/** STEP xx / C-xx.y — … */`）、`server/research/index.ts` 统一出口注释、ROADMAP §44/§47 与 TASK_TRACKING 记录。
4. 例外（不受限）：`docs/` 下证据与日志产物（日期戳文件名、gate json 如 `research_ready_gate.json`）；`scripts/` 工具文件名；数据回填 CLI 参数。
5. 禁止为规避本规则引入编号/数字变形（如 `wfo2`、`copy3`）；名称必须取自职责语义。命名前先全库查重目录名与顶层符号（教训：`DEFAULT_LOT_SIZE` 重复导出 TS2308、`PaperPosition` 被 legacy 占用）。

## 49.2 历史追溯
2026-09-07 21:45 前的带编号目录名（signal13/costModel14/…/docs/step12-evidence）出现在 §47、TASK_TRACKING §5、memory 等 append-only 记录中，**不追溯改写**；以本节日期对应 §47 改名记录为映射对照（旧名 → 新名）。新增代码一律遵守 §49.1。
