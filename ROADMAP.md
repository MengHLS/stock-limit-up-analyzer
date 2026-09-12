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
> 最后实查：**2026-09-12 19:00 GMT+8**（**STEP RESEARCH-006.1（架构线）完成 —— Research → Strategy Bridge：数据库 + Domain Model**，状态 **DATA_READY**（migration `0036` 已实落**真实 TiDB** 且 `--check` PASS；桥的领域层双仓储可用；**业务 API / promote / transition / 前端全部仍不存在**）。触发 = 用户 30 节规格，**唯一架构基准 = `docs/research/RESEARCH-006.0-architecture.md`**。**一、数据库（纯增量：零数据迁移、零回填、零 FK）**：① `research_strategy_candidate` **+4 列**（`sourceDatasetVersionId` bigint NULL / `sourceResearchRunId` bigint NULL / `sourceTraceJson` longtext NULL / `sourceDatasetDivergenceReason` varchar(512) NULL）+ 索引 `idx_research_candidate_source_dataset_version`；② **新表** `strategy_research_provenance`（**13 列** + `UNIQUE(strategyVersionId)` + 3 索引；`origin` varchar(16) 默认 `DIRECT`；**零 FK**）。migration = 手写 `drizzle/0036_research_strategy_bridge.sql`（6 语句全带 `-- @guard:`）+ 幂等 `scripts/applyResearchStrategyBridge.mjs`（apply / `--dry-run` / `--check`，18.6 KB，逐项查 `information_schema`）。**实查断言全 PASS**：列类型/nullable/列序逐项正确；既有 **12 张 `research_*` 表列签名零意外变化**（Candidate = 基线 14 列 + 恰好 4 列，逐列比对）；`strategy_versions` / `strategy_version_datasets` **无任何 research 列**（Canonical 零污染）；**全库 FK = 0**；`--check` PASS 且**二次 apply 幂等**（6 语句全 skip、仍 PASS）。**行数守恒（apply 前后逐表 20 张）**：`research_result` 674→674、`research_conclusion` 7→7、`research_run` 8→8、`research_analysis` 19→19、`research_strategy_candidate` **0→0**、`strategy_research_provenance` 建表即 **0**、`strategy_versions` 0→0、`dataset_version` 2→2 ⇒ **migration 未自动产生任何 Candidate，既有研究数据零变化**。**二、Domain Model**：Candidate 领域类型 + 4 个 `source*` 字段 —— `sourceDatasetVersionId` 从 `research_experiment.datasetVersionId` **复制后不可变**（它回答「基于哪份数据研究出来」，**不是**「未来执行用哪份数据」）；`sourceResearchRunId` 经 `evidence.primaryAnalysis.analysisId → research_analysis.runId` **两跳**解析，**提不出即 NULL、禁止伪造**；`sourceTraceJson` 是 provenance **快照**（**不是** `research_result` 第二份存储 —— Result 重算即被 `deleteByAnalysis`+`createMany` 覆盖）；`sourceDatasetDivergenceReason` **仅当**研究来源 ≠ 执行绑定才非空（一致时必须 NULL，禁填空话）。`db.ts` / `inMemory.ts` **同判据、同语义**（create 写 4 列 / getById 读回 / `list({sourceDatasetVersionId})` 过滤 / update 边界一致）；`ResearchStrategyCandidateUpdatePatch` 收紧，`CreateInput` 自动获得 4 字段。**三、溯源仓储（Strategy 侧**独立切面**，不是 `strategy_versions` 的列）**：新增唯一桥目录 `server/research/strategyCandidate/`（`types.ts` / `provenance.ts` / `provenanceContract.ts` / `index.ts` + 3 个测试）—— `StrategyResearchProvenance` 领域类型 + 错误码（`ALREADY_EXISTS` / `NOT_FOUND` / `INVALID_INPUT`）+ `Db`/`InMemory` 双实现；能力 = `create` / `getByStrategyVersionId` / `listByStrategyId` / **`getBySourceCandidateId`（未来 promote 的幂等闸门）** / `deleteByStrategyId`（**非级联**，由未来 `deleteStrategy` 应用层显式调用）/ `deleteByStrategyVersionId`；**无 update**（历史事实快照，可改即伪造历史）。`source*` 全为**快照值 + 零 FK** ⇒ 上游行删除后仍能回答「从哪来」，Research 模块整个消失也不影响 Strategy 独立 validate/backtest/execute（Q10 = YES，**display-only**）。**四、⚠️ 实施中发现并已裁定的规则冲突（必须登记）**：006.1 §15 要求 `status` / `strategyDefinitionId` **亦**不可经普通 update 修改；但实查 `server/researchCore/repository/inMemory.test.ts`（**RESEARCH-001 既有验收**）**用 `update({status})` 走完 `DRAFT→REVIEW→ACCEPTED→CONVERTED`** 并断言非法迁移被拒 —— 仓库层摘出会**直接破坏既有基线**（违反 006.1 §26 / §16）；且 **006.0 §10.1 已把「摘除 `status`」明确划归 API 层（006.2）**。⇒ **裁定**：① **硬拒**（类型层排除 + 运行时 `assertCandidateUpdatePatchKeys` **响亮失败、不静默忽略**）= `experimentId` / `conclusionId` / 4 个 `source*`（结构锚 + 历史快照）；② **状态机守卫**（`assertCandidateTransition` + `assertCandidateConversionCoherence`，**既有语义未改**）= `status` / `strategyDefinitionId`，006.2 在 API 层摘出、006.3 起 `CONVERTED` 只能由 promote 到达。裁定已写入 `candidates.ts` / `contract.ts` / `schema.ts` 三处注释，并有「两清单无交集」的防漂移断言。**五、边界守护（把「靠人守」变成「靠测试守」）**：新增 `importBoundary.test.ts`（6 例，**读源文件文本 + 解析 import 说明符**，注释里的模块名不算）—— `server/researchCore/**` 不 import `strategyPersistence|strategySchema` ✓；`server/research/strategyPersistence/**` 不 import `researchCore` ✓；`server/datasetRegistry/**` 无反向依赖 ✓；**只有桥目录可同时 import 两者** ✓（006.3 加 Strategy 依赖时该断言开始真正生效）；桥不得被反向 import ✓；桥不得 import legacy `server/research/index.ts` ✓。**六、验收**：`npx tsc --noEmit` **RC=0**；聚焦（researchCore + strategyCandidate + strategyPersistence + datasetRegistry）**24 文件 / 421 例全过**；全量 **220 文件 / 3490 例，15 失败 / 7 文件 —— 与既有基线逐项一致（零新增失败）**；真实库 `scripts/verifyResearchStrategyBridge.mts` **50 ✓ / 0 ✗**（含**裸 SQL 独立证明 `UNIQUE(strategyVersionId)` 是真实数据库约束** ⇒ `ER_DUP_ENTRY`，以及**自建自清行数守恒**、**DB 与 InMemory 跑同一份契约且用例名集合逐字相同**）。**产物**：`docs/research/RESEARCH-006.1-implementation.md`（16 节）+ 证据 `_r0061_probe_result.md` / `_r0061_apply.json` / `_r0061_apply2.json` / `_r0061_check.json` / `_r0061_verify.log` / `_r0061_fulltest.log`。**未做（§29 严禁偷跑，已实查确认仍不存在）**：`research.strategyCandidate.createFromConclusion` / `promote` / `transition` / `get` 端点、Candidate 前端登记与编辑、Provenance UI、Research → Strategy 自动转换、Strategy Version 自动生成、`strategy_drafts`、新状态值、`StrategyService` 行为改动、`saveVersion` 接入 provenance。**下一 STEP = `RESEARCH-006.2`（Research Conclusion → Candidate Service）**，其后 006.3（promote + provenance）/ 006.4（API + 前端）/ 006.5（真实 TiDB + tRPC + Regression）；**一次只实施一个 STEP，006.1 未提前开发 006.2~006.5**。
>
> **【上一版留档 · 2026-09-12 18:35 · RESEARCH-006.0（架构线）DESIGN DONE】**
> 最后实查：**2026-09-12 18:35 GMT+8**（**STEP RESEARCH-006.0（架构线）完成 —— Research → Strategy Candidate/Draft 架构审计与接口设计**，状态 **DESIGN DONE**（**只读审计 + 设计，非实施**；**未改任何 schema / 未写 migration / 未改任何业务代码 / 未做数据迁移**）。触发 = 用户 26 节规格：在不改库、不改业务代码的前提下，审计 Research / Strategy / Dataset Registry 三模块真实实现，设计一条单向可追溯的 `Dataset Registry → Research → Conclusion → Candidate → Strategy Version` 链路。**审计方法**：直接读当前源码 + **真实 TiDB 只读实查**（新增探针 `_r006_probe.mjs` → 证据 `_r006_probe_result.md`：`information_schema` 列/索引/外键 + 21 张表行数与状态分布）。**最重要的发现 —— 桥已经建好，只是两头没接线**：`research_conclusion`（实查 **7 行**，全 `DRAFT`，5 SUPPORTED / 2 PARTIALLY_SUPPORTED）与 `research_strategy_candidate`（实查 **0 行**）**都已存在**；`server/researchCore/candidates.ts` 的机读状态机（`CANDIDATE_TRANSITIONS`、`assertCandidateTransition`、`assertCandidateConversionCoherence`）与 `repository/contract.ts:219-225` 的完整 Repository 契约（`create/getById/list/update/delete`）**均已实现** ⇒ **`RESEARCH_CONCLUSION` 与 `STRATEGY_CANDIDATE` 都不是 NOT IMPLEMENTED，缺的只是调用点**（全库 `candidates.create` 零调用；`maintenance.ts` 只用 `list`/`delete`）。**故本设计不新建任何 Candidate 对象，只激活既有写入位。** **六个真实断点**：B1 Candidate 无写入路径；B2 Conclusion 仅由引擎规则式生成（`engine.ts:311`）、**无 create/update 端点**；B3 Candidate ↔ Strategy 零连接（`strategyDefinitionId` 建了索引无写入者）；B4 `strategy_versions` 真实 15 列中**无任何 research 溯源列**；B5 `research_result`/`_analysis`/`_run` 实查**零 dataset 相关列**（坐标只在 `research_experiment.datasetVersionId`，且该列**创建即冻结**）；B6 `research.lifecycle.transition` 是**无状态纯函数**（不落库），与 `setVersionStatus` 构成两套状态真相。**Research 上游资格六问（指令 §19）**：❌ **Result 不是 immutable**（`engine.ts:712-714` `deleteByAnalysis` 后 `createMany` ⇒ 重算即替换）⇒ **不能作 provenance 锚点**；❌ **Conclusion → Run 不能列级反查**（`research_conclusion` **无 `runId`**，只能两跳解析 `evidence.primaryAnalysis.analysisId`，且可能提不出 id）；❌ **级联删除会毁桥**（`deleteExperimentCascade` **连 candidate 一起删**）⇒ **溯源快照必须写到 Strategy 侧**；⚠️ Result 缺结构化 Dataset/Config/Horizon/filter 上下文且无指纹无版本号。**方案裁定 = C（`Candidate` 即 Draft）**，理由：唯一**不新增领域对象**（既有表 + 状态机 + 契约齐备）；A/B 会让「Draft」同时是对象与状态、与 **C-21.1 八态撞名**（八态已含 `Draft` 与 `Candidate`）；A/B 的 Draft 表若承载可执行定义即**第二 Canonical SoT**（§25 禁止 4）；**Candidate 的规则草图与 Strategy Definition 是两套不可能同构的词表**（`ResearchEntryRule{event:string}` vs `entry.event.type ∈ {FIRST_LIMIT_UP,…}` + 字段时间域目录 + Look-Ahead L1–L8）⇒ 强转必须经**显式转换器**，该转换器正属 promote 服务。**溯源最小集**：`sourceConclusionId` + **`sourceResearchRunId`（唯一无法列级反查、可空即如实承认提不出）** + `sourceExperimentId` + `sourceDatasetVersionId`（**快照**）；**不存 `resultId`**（Result 可变）；`analysisId` 不列化（一结论可引多个 analysis）。**坐标**：`datasetVersionId = dataset_version.id` 唯一口径不变；明确区分 **Research Source Dataset**（快照）与 **Strategy Execution Dataset** ⇒ **允许不同**（缺省继承；不同须显式 overrides + 理由并显著提示），禁强制一致、禁改写研究来源。**DB 逻辑设计（不含 DDL）**：① `research_strategy_candidate` **仅增 4 列**（`sourceDatasetVersionId` / `sourceResearchRunId` / `sourceTraceJson` / `sourceDatasetDivergenceReason`；**不加**唯一约束 —— 明确**允许一个结论产多份候选**）；② **新增 1 表** `strategy_research_provenance`（`UNIQUE(strategyVersionId)`；`source*` 全为**快照值非 FK**；`origin=DIRECT|INHERITED`；**零外键**）；③ **不动** `strategy_versions` / 5 投影 / `StrategyDocument` / `StrategyVersionRecord`（**不递增 recordVersion** ⇒ 指纹与既有版本零影响）；④ **不建 `strategy_drafts`**。**防循环依赖**：唯一桥 = 新增 `server/research/strategyCandidate/`（`definitionBuild` 为**唯一显式转换器**）；铁律「`researchCore` 禁 import `strategySchema|strategyPersistence`；`strategyPersistence` 禁 import `researchCore`」；唯一例外 = `StrategyService` 接受**可选注入端口** `StrategyProvenancePort`（与既有 `DatasetVersionReferencePort` 注入同风格、缺省 no-op ⇒ 不构成反向依赖），供 `cloneVersion` 继承溯源。**API**：**保留**既有 `researchEngine.listCandidates`（不为好看搬路由）；新增 `get`/`createFromConclusion`/`update`（**白名单摘除 `status`**）/`transition`（🔴 **拒绝 `CONVERTED`**）/`promote`（**唯一能写 `CONVERTED` 与 provenance 的入口**）；读 `publicProcedure`、写 `adminProcedure`（与既有真实代码一致）。`promote` 8 步强制顺序 + **幂等闸门**（防重试产生第二份 Strategy）；🔴 **诚实登记跨存储事务缺口**：Strategy 写入与 candidate 回写**非原子** ⇒ 回写失败抛 `PROMOTE_WRITEBACK_FAILED` 并带上已生成的 `strategyId`，由幂等闸门兜底。**状态机**：Candidate **沿用既有六态不改**（补两条纪律：`CONVERTED` 只能由 promote 到达；`update` 摘除 `status`）；Strategy Version **复用 C-21.1 八态**，**明确拒绝**指令 §12 建议的四态（与八态重叠且更窄）；初始状态只能取 `GENESIS_STATUSES = [Draft, Research]`。**删除策略**：Research = provenance（快照）/ Strategy = independent artifact ⇒ 既有级联**保持不动**，Strategy 侧靠快照独立存活，**不需要** `SOURCE_DELETED` 列。**首板回踩设计级示例**走通全链（含 🔴 **「首板日开盘价」必须写 `prefix.rd0.open` 而非 `event.open`** —— T 日 OHLCV 在 `prefix.rd=0`，`event` 表无 OHLCV 列）。**产物**：唯一新增文件 `docs/research/RESEARCH-006.0-architecture.md`（16 节 + **Q1–Q10 结论表** + 审计证据清单）；**未修**任何审计发现的缺陷（只登记）。⚠️ **编号撞车（登记待裁定）**：§47 已用 `RESEARCH-006/007/008`（9m/9n/9o）指代**结果页可读性前端任务**，与本架构线**同名不同物** ⇒ 本 STEP 一律带 `.0/.1/…` 子号，后续建议在 §47 统一加「架构线」前缀。**下一 STEP**：`RESEARCH-006.1`（数据库 + Domain Model）⇒ `006.2`（Conclusion → Candidate Service）⇒ `006.3`（promote + provenance + clone 继承）⇒ `006.4`（API + 前端）⇒ `006.5`（真实 TiDB + tRPC + Regression）；**一次只实施一个 STEP**。）

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
> 🔴 **同期实查修正既有结论（涨停口径审计）**：**新增 `scripts/verifyLimitUpCaliber.mts`（ds_* 版本口径真伪审计）**，实查既有两个版本 —— **v1(390001) 事件 1,130 行中「向下舍入型」436 行 = 38.6%**、**v2(390002) 13,579 行中 5,039 行 = 37.1%**，且两版本 `limitUpPrice` **逐元等于** `exchangeLimitUpPrice(pc, ratio)`（1,130/1,130、13,579/13,579），并经 `stock_daily_prices` **原始行情交叉验证**（如 `000007.SZ 2026-08-18` 真实 close=11.69 / 昨收 10.63 → 未舍入阈值 11.693000000000001 → **旧口径必然判否**，但 v1 确有该事件）。向下舍入型事件在「未四舍五入」旧口径下**根本不可能被产出**（旧口径上限 = 1,130−436 = 694）⇒ **既有 `ds_*`（v1/v2）的涨停判定口径 = 【四舍五入到分】，与现行代码同源，§44 此前「ds_* 仍是旧口径」的表述已不成立**；38.03% 实为 `_limitprecision_probe.mjs` 测得的**旧谓词对原始行情**的漏判率，**不是** `ds_*` 表数据的属性（该探针只读 `stock_daily_prices`，从未读过 `ds_*`）。**新发现（真实缺陷，待处理）**：**v2(390002) 构建不完整** —— 仅 `event=13,579`，`prefix`/`post`/`path`/`outcome` **全为 0**，`status` 永久停留 `BUILDING`（`runner.ts` `completeJob → markReady` 两次写库非原子这一既有已知缺陷的下游后果）⇒ v2 **不可用于任何研究**，需**补完构建**（工程问题，**非**口径问题）；审计脚本当前 7/8 PASS，唯一失败项即此。
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
> 真实数据实测（`_limitprecision_probe.mjs`，2025-01-01..2026-09-04 / 299,946 行）**收盘价恰为涨停价的封板样本 4,325 个中漏判 1,645 个 = 38.03%**。
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
> **并行排查（结论：非重复写入）**：针对「path/outcome 数据一直重复」的反馈，真实 DB 分三层取证（`_dupcheck_probe.mjs`）——
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
   - **9p. （RESEARCH-006.0 · 架构线）Research → Strategy Candidate/Draft 架构审计与接口设计** ✅ **已完成（2026-09-12 18:35，DESIGN DONE）**：触发 = 用户 26 节规格（不改库 / 不改业务代码，只审计 + 设计 `Dataset Registry → Research → Conclusion → Candidate → Strategy Version` 单向可追溯链路）。**方法** = 源码直读 + **真实 TiDB 只读实查**（`_r006_probe.mjs` → `_r006_probe_result.md`）。**最重要发现 = 桥已建好、两头没接线**：`research_conclusion`（**7 行**全 `DRAFT`）与 `research_strategy_candidate`（**0 行**）**都已存在**，`researchCore/candidates.ts` 状态机 + `contract.ts:219-225` 完整 Repository 契约**均已实现** ⇒ 二者**都不是 NOT IMPLEMENTED**，缺的只是**写入调用点**（`candidates.create` 全库零调用）。**六个断点** B1~B6（无写入路径 / Conclusion 无 CRUD 端点 / Candidate↔Strategy 零连接 / `strategy_versions` 无 research 列 / 三张表零 dataset 列 / lifecycle 为无状态纯函数）。**Research 上游资格**：🔴 **Result 非 immutable**（`engine.ts:712-714` 重算即替换）⇒ 不能作锚点；🔴 **Conclusion 无 `runId`** ⇒ Run 只能靠 `evidence` 两跳解析；🔴 **级联删除连 candidate 一起删** ⇒ **溯源快照必须落到 Strategy 侧**。**裁定方案 C**（`Candidate` 即 Draft，**不建 `strategy_drafts`**）：唯一不新增领域对象；A/B 会与 **C-21.1 八态撞名**、并使 Draft 表成为**第二 Canonical SoT**；Candidate 草图与 Strategy Definition 是**两套不可能同构的词表**（须经显式转换器）。**DB 逻辑设计（本 STEP 不含 DDL）**：candidate **+4 列** + **新 1 表** `strategy_research_provenance`（快照值、零 FK）；**不动** `strategy_versions` / 5 投影 / `StrategyDocument`（不递增 recordVersion）。**API**：保留既有 `listCandidates`；新增 `get`/`createFromConclusion`/`update`（摘除 `status`）/`transition`（🔴 拒绝 `CONVERTED`）/`promote`（唯一转正入口）。**唯一桥** = 新增 `server/research/strategyCandidate/`，铁律「`researchCore` ⇄ `strategyPersistence` **互不 import**」。**产物**：`docs/research/RESEARCH-006.0-architecture.md`（16 节 + Q1–Q10 + 证据清单）。**零改动**：无 schema / 无 migration / 无业务代码 / 无数据迁移；**未修**任何审计发现缺陷（只登记）。⚠️ **编号撞车**：§47 已用 `RESEARCH-006/007/008`（9m/9n/9o）指代**结果页可读性前端任务**，与本架构线同名不同物 ⇒ 架构线一律带 `.0/.1/…` 子号，建议后续在 §47 统一加「架构线」前缀。**下一 STEP = RESEARCH-006.1（数据库 + Domain Model）**，其后 006.2（Conclusion→Candidate Service）/ 006.3（promote + provenance）/ 006.4（API + 前端）/ 006.5（真实 TiDB + tRPC + Regression）；**一次只实施一个 STEP**。
   - **9q. （RESEARCH-006.1 · 架构线）Research → Strategy Bridge：数据库 + Domain Model** ✅ **已完成（2026-09-12 19:00，DATA_READY）**：触发 = 用户 30 节规格（基准 = `docs/research/RESEARCH-006.0-architecture.md`）。**一、数据库（纯增量）**：① `research_strategy_candidate` **+4 列**（`sourceDatasetVersionId` / `sourceResearchRunId` / `sourceTraceJson` / `sourceDatasetDivergenceReason`，**全 NULL-able ⇒ 零回填**）+ 索引 `idx_research_candidate_source_dataset_version`；② **新表** `strategy_research_provenance`（13 列 + `UNIQUE(strategyVersionId)` + 3 索引；**零 FK**）。migration = 手写 `drizzle/0036_research_strategy_bridge.sql`（6 语句全带 `-- @guard:`）+ 幂等 `scripts/applyResearchStrategyBridge.mjs`（apply / `--dry-run` / `--check`）。**二、实查断言全 PASS（真实 TiDB `information_schema`，非 Drizzle 推断）**：4 新列类型/nullable ✓、Candidate 列序 = 基线 14 + 恰好 4（**12 张 `research_*` 表逐列比对**）✓、provenance 13 列类型/nullable/KEY 逐项 ✓、`UNIQUE(strategyVersionId)` ✓、3 索引列名 ✓、**FK：Candidate 0 / Provenance 0 / 全库 0** ✓、`strategy_versions`/`strategy_version_datasets` **无 research 列**（Canonical 零污染）✓、`--check` PASS ✓、**二次 apply 幂等**（6 语句全 skip）✓。**三、行数守恒（20 张表前后逐表）**：`research_result` 674→674、`research_conclusion` 7→7、`research_strategy_candidate` **0→0**、`strategy_research_provenance` 建表即 **0**、`strategy_versions` 0→0、`dataset_version` 2→2 ⇒ **未自动产生任何 Candidate、既有研究数据零变化**。**四、Domain Model**：Candidate 类型 +4 个 `source*`（`sourceDatasetVersionId` 复制自 `experiment.datasetVersionId` 后**不可变**；`sourceResearchRunId` 两跳解析、**提不出即 NULL 禁伪造**；`sourceTraceJson` 是 provenance **快照**而非 Result 第二份存储；`sourceDatasetDivergenceReason` 一致时**必须 NULL**）；`db.ts` / `inMemory.ts` 同判据同语义（写 4 列 / 读回 / `list({sourceDatasetVersionId})` 过滤 / update 边界一致）。**五、溯源仓储（Strategy 侧独立切面）**：新增唯一桥目录 `server/research/strategyCandidate/`（`types` / `provenance` / `provenanceContract` / `index` + 3 测试）；`Db`/`InMemory` 双实现；能力 = `create` / `getByStrategyVersionId` / `listByStrategyId` / **`getBySourceCandidateId`（未来 promote 幂等闸门）** / `deleteByStrategyId`（非级联）/ `deleteByStrategyVersionId`；**无 update**（历史事实快照不可改）；`source*` 全为**快照值 + 零 FK** ⇒ Research 消失也不影响 Strategy 独立运行。**六、⚠️ 实施中发现的规则冲突与裁定（必须登记）**：006.1 §15 要求 `status`/`strategyDefinitionId` **亦**不可经普通 update 修改，但（a）**RESEARCH-001 既有验收**（`researchCore/repository/inMemory.test.ts`）**用 `update({status})` 走完四态迁移并断言非法迁移被拒**，（b）006.0 §10.1 已把「摘除 `status`」**划归 API 层（006.2）**。⇒ **裁定 = 分两类**：① **硬拒**（类型层 + 运行时 `assertCandidateUpdatePatchKeys` 响亮失败）= `experimentId`/`conclusionId`/4 个 `source*`；② **状态机守卫**（既有 `assertCandidateTransition` + `assertCandidateConversionCoherence` **语义未改**）= `status`/`strategyDefinitionId`，006.2 在 API 层摘出、006.3 起 `CONVERTED` 只能由 promote 到达。裁定写入三处注释 + 「两清单无交集」防漂移断言。**七、边界守护**：新增 `importBoundary.test.ts`（6 例，**读源码文本解析 import 说明符**）—— `researchCore` 禁 import `strategyPersistence|strategySchema` ✓、`strategyPersistence` 禁 import `researchCore` ✓、`datasetRegistry` 无反向依赖 ✓、**只有桥可同时 import 两者** ✓、桥禁被反向 import ✓、桥禁 import legacy `research/index.ts` ✓。**八、验收**：`npx tsc --noEmit` **RC=0**；聚焦（researchCore + strategyCandidate + strategyPersistence + datasetRegistry）**24 文件 / 421 例全过**；全量 **220 文件 / 3490 例，15 失败 / 7 文件 = 与既有基线逐项一致（零新增失败）**；真实库 `scripts/verifyResearchStrategyBridge.mts` **50 ✓ / 0 ✗**（含**裸 SQL 独立证明 UNIQUE 是真实数据库约束** ⇒ `ER_DUP_ENTRY`、**自建自清行数守恒**、**DB 与 InMemory 跑同一份契约且用例名集合逐字相同**）。**产物**：`docs/research/RESEARCH-006.1-implementation.md`（16 节）+ 证据 `_r0061_probe_result.md` / `_r0061_apply.json` / `_r0061_apply2.json` / `_r0061_check.json` / `_r0061_verify.log` / `_r0061_fulltest.log`。**九、§29 严禁偷跑（实查确认仍不存在）**：`createFromConclusion` / `promote` / `transition` / `get` 端点、Candidate 前端、Provenance UI、自动转正、`strategy_drafts`、新状态值、`StrategyService` 行为改动、`saveVersion` 接入 provenance。**下一 STEP = `RESEARCH-006.2`（Research Conclusion → Candidate Service）**；**一次只实施一个 STEP**。
   - **9r. （RESEARCH-009 · 分析建设线）把「回撤分档 × 建仓后四口径」与「多候选日回撤触发」建成正式分析** ✅ **已完成（2026-09-12 19:35）**：触发 = 用户「**把这些都建成分析**」。**新建 Run `480001`**（Experiment `240002` / `datasetVersionId 390002` / runNo=5）—— 不选 `runIncremental` 的理由：它**不生成结论**，而结论是用户读结果的主入口。**7 个分析**：A 组 4 个 `SEGMENT_RELATION`（窗 A = `max_drawdown[0,5]` 分 5 档；窗 B = `[5,20]` 分别取 `return` / `max_return` / `min_return` / `max_drawdown` ⇒ `420001~420004`）；B 组 3 个 `CONDITIONAL`（`pullback_from_event_high_{h}d <= −0.08` → `segment_return_{h}_20d`，h = 2/3/5 ⇒ `420005~420007`）——「回撤触发式建仓」在现有能力内的近似。**执行**：样本 23,978 / 7 分析全 COMPLETED / 167 结果行 / `conclusionId 360001` `SUPPORTED` / 装配 43.3 s、总 64.3 s。**四条结论**：① 期末收益档 5（最浅）**−1.61%** vs 档 2 **+0.42%**，`SPREAD_TOP_BOTTOM` **−1.80%**（p≈5.6e-6）但**非单调**、单因子区分度仅 0.4~2pp；② 风险侧更明显 —— 档 5 的最大不利偏移 **−13.93%** vs 档 1 **−11.23%**、最深跌幅 **−11.72%** vs **−9.00%** ⇒ 「等回撤再买」主要价值是**少亏**；③ 最大有利偏移**反向**（档 5 最高 16.56%）⇒ 未回撤那批「上下都大」；④ 全档胜率 < 50%、中位数全负 ⇒ 典型右偏，**只读均值会读反**。**B 组**：`DIFFERENCE` h=2 **−0.97pp** / h=3 **+0.24pp** / h=5 **+0.55pp** ⇒ **触发时点本身是信息**（越早深跌越是承接差）。**零代码改动**（未改 `server/**` 与 `client/**`、零迁移、零新端点、零新依赖）；建分析走产品领域层（`createAnalysesBatch` + `ResearchEngine`），**无第二套口径**。详见 §47 19:35 条。
   - **9s. （RESEARCH-009B · 呈现修复）`max_return`/`min_return` 口径不该产出 `WIN_RATE` ＋ 指标标签未按目标变量口径改写** ⬜ **待做（需改代码 ⇒ 必须排到「无在途 Run」的时段）**：由 9r 的落库结果暴露（**数字全对、呈现会读错**）。(a) **引擎侧**：`analyses/segmentRelation.ts:124` 的 `winRateMeaningful = windowB.stat !== "max_drawdown"` 判断不全 —— `max_return` / `min_return` 同样是**极值口径**，「取值 > 0 的占比」不构成胜率（实测 A2 = **94.5%**、A3 = **2.7%**），应一并屏蔽并给出同款说明；顺带核对 `conditional.ts` 把 `MAX_DRAWDOWN` 作为附加指标时的口径标注。(b) **前端侧**：`researchEngineAdapter.ts` 的 `METRIC_LABELS` 是静态表 ⇒ `max_return` 目标的「平均最大有利偏移 +13.75%」显示成「平均收益」；应新增「按目标变量口径改写标签」的纯措辞函数（**只改措辞、不改数字、不重算**，遵展示层纪律），至少在表头 / 结论速览 / 图上生效。(c) 附带：B 组三个分析的 `ALL` 基线 n 不同（22,958/22,951/22,944），结果页应说明「对照组分母按各目标变量可用样本计」，避免被当成数据不一致。
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

- **2026-09-11 00:26 GMT+8 — WORK RESEARCH-002 Research Engine MVP 交付完成（真实 Dataset 端到端跑通、禁止 Mock）**。按 RESEARCH-002 规格（§1~§22）在已稳定的 RESEARCH-001 持久层之上实现**真正的 Research Engine**。**范围严格限定**：只做 DESCRIPTIVE / EVENT_STUDY / QUANTILE / CONDITIONAL / STABILITY 五类分析；**明确排除** IC·RankIC / 因子搜索 / ML / 自动策略生成 / Parameter Search / Backtest / OOS / WFO / Robustness。**分层**（§3 强制，禁止堆成一个巨型文件）：`ResearchEngine`(engine.ts 10 步编排) → `ResearchDatasetReader`(唯一数据入口，无散落 SQL) → `AnalysisExecutorRegistry`(按 analysisType 派发) → 5 个独立 Executor(analyses/*.ts) → `MetricCalculator`(metrics.ts 全系统唯一指标实现) → `ResearchResultWriter`(复用 researchCore/results.ts 结构化落库) → `ConclusionBuilder`(conclusion.ts 规则式保守结论)。文件：`server/researchEngine/` **21 文件 / 4,156 行** + `server/researchEngineRouter.ts` 428 行（**17 个 tRPC 端点**，已注册 `appRouter.researchEngine`）+ `scripts/verifyResearchEngine.mts` 529 行。**复用纪律**：统计全部复用 `shared/quant-stats.ts`（零重写）；`datasetRegistry/query.ts` 只做**纯增量**扩展（`loadOutcomesBatch`/`loadPathsBatch`/`loadRawBarsBatch`/`getPathRelativeDayRange`，既有分页语义一字未改、空 id 不发 SQL、版本一律下推）；**不合并** `server/researchEngine` 进 `server/research/index.ts` barrel（那里是正交的策略/回测链路）；**未新增迁移**（故完全不触碰已停维护的 `drizzle/meta/_journal.json`）；`ds_*` 物理表与既有表**零改动**。**PIT 安全**（§6）：不重新实现 Dataset 的 PIT 逻辑而是**镜像其结构事实**——变量解析器接收**类型互斥**的 `FeatureSources{event,prefixBars}`（rd≤0）与 `OutcomeSources{pathRows,outcomeRows}`（rd≥1），写错即**编译错误**；运行时再加 `VARIABLE_ROLE_VIOLATION`/`UNKNOWN_VARIABLE` 具名断言；变量目录**绝不为不存在的视界发明变量**（视界取自 `outcome.horizon` 与 `path.relativeDay` 真实值）。**PIT 硬证明**：测试「把样本中全部未来数据（path/outcome）整体抹掉后重算特征 → 特征值逐字节完全一致」。**结论防夸大**（§14）：固定优先级选主分析（QUANTILE>CONDITIONAL>EVENT_STUDY>STABILITY，**非**按效应挑选）、R1~R5 短路规则、**每份结论与证据内嵌免责声明**、`confidence` 显式标注 `confidenceIsNotPValue:true` 且给出 `confidenceBasis`。**真实 Dataset E2E**（§15 验收案例，Dataset Version **390001** = `first_limit_pullback` v1 / READY / 2026-08-01→08-31 / 1130 事件）：Experiment「首板换手率与未来5日收益研究」→ Hypothesis → Run → **5 个分析全部 COMPLETED**（QUANTILE 十分位 53 行 / DESCRIPTIVE 38 / EVENT_STUDY 26 / CONDITIONAL 16 / STABILITY 5）→ **138 结果行** → 结论 **`PARTIALLY_SUPPORTED`**（主观置信 0.5833）。核心数值：**QUANTILE 顶底分位差 = −3.0785%**（Q1 +3.0402% vs Q10 −0.0383%，t=−1.6799，p=0.0930，n=214）→「首板换手率越高、未来5日收益越低」方向为负但**未过统计门槛**（p=0.0930>α=0.05）、分位均值**不单调**（Q2 最高、Q8 为负 → 方向一致性 0.667），引擎**如实给出 PARTIALLY_SUPPORTED 而非声称显著**；**独立复算**（脱离引擎代码路径、直接读物理表自行算切点分组）得 −0.030785，**与引擎输出完全一致** → 可复现、非黑箱；全链路经 Repository 查回（`getExperiment`/`getRun`/`getAnalysis`/`getAnalysisResults`/`listConclusions`）证明可追溯。**性能真实测量**（§18，新增 `sampleBuildMs` + 逐分析 `durationMs` 落库返回）：引擎总计 **27,523 ms** = Dataset 装配 **9,645 ms** + 5 分析 **9,770 ms**（QUANTILE 2072 / DESCRIPTIVE 2122 / EVENT_STUDY 2198 / CONDITIONAL 1724 / STABILITY 1654）+ 结论与落库 ~8,108 ms；分析纯计算在毫秒级 → **瓶颈是 TiDB 跨境往返（RTT≈0.5s），属延迟受限而非算力受限**，优化方向是减少往返次数。**本次发现并修复的 6 个真实缺陷**（合成夹具与真实数据各暴露一半，证明双轨测试必要）：① **预检失败不落库** → Run 永久停 `PENDING`（违反 §22 可追溯）→ 引入 `runIdentified`：Run 已确认可归因后任何失败都落 FAILED+errorCode，并用 `startedAt` 空/非空区分「预检拒绝」与「执行中崩溃」；无法归因（Run 不存在/不归属/状态不可执行）则**绝不改写状态**（防误点破坏已完成运行）；② **EVENT_STUDY 无条件要求 `max_return_{h}d` 等 outcome 聚合变量** → 配置 T+1/T+3 时在解析需求阶段直接 `UNKNOWN_VARIABLE` 崩溃（根因：`future_return_*` 来自 path 1..20，而 `max_return_*`/`max_drawdown_*`/`is_breakout_*` 来自 outcome 仅 {5,10,20}，两者视界集合不同）→ 改为按目录过滤 + 缺失项如实记入 notes（不虚构）；③ **CONDITIONAL 同族缺陷**：`drawdownVariableFor(target)` 无条件要求 `max_drawdown_{h}d` → 目标为 path 独有视界（如 `future_return_3d`）时崩溃 → 同样按目录确认存在后才请求；④ **STABILITY 单组恒为 `STABILITY_RATIO=1.0`** → 会被误读为「高度稳定」→ 与 QUANTILE「实际分组<2 不产出指标」保持一致，改为**分组数<2 时不产出该指标**并如实说明「无法评估跨期稳定性」（真实数据 v1 恰好只有 1 个板块 `main`，该修复直接生效）；⑤ **测试夹具变量目录比真实数据宽松**（outcome 视界误写 `[1,3,5,10,20]`）→ 掩盖缺陷 ②③ → 已改为与真实 Dataset 同构（path 1..20 / outcome {5,10,20}）并加注「不要再改回去」；⑥ **验收脚本分组样本数被后序指标覆盖** → CONDITIONAL 中 `MEAN_RETURN`(n=1065) 与 `MAX_DRAWDOWN`(n=1127) 分母本就不同，展示时被覆盖成错误分母 → 改为逐指标记录 n 并显式标注分母不一致。**验证**：`npx tsc --noEmit` **exit 0**；新增测试 **8 文件 / 103 例全过**（metrics 15 / variables 7 / pit 5 / conditionEvaluator 11 / conclusion 11 / engine 15 / analyses 21 / router 18）；聚焦回归 `datasetRegistry`+`researchCore`+`shared` **19 文件 / 376 例全过**；**全量 vitest 194 文件 / 2839 例**（2823 通过 / 16 失败），**失败文件 8 个与 RESEARCH-001 基线完全一致**（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `researchRunRouter` / `tushare.secret` / `tushareTradingCalendar`，全为既有环境依赖失败：Tushare token / 网络 / DB / 认证快照），**零新增失败**，通过数 +103 恰为本次新增。**产物**：报告 `docs/research/RESEARCH-002-report.md`（15 节）、证据 `docs/research/RESEARCH-002-e2e-evidence.json`、脚本 `scripts/verifyResearchEngine.mts`（默认跑完清理，`--keep` 保留，`--all` 跑 5 类分析，`--version=` 指定版本）。**遗留（RESEARCH-003 前置）**：🔴 **DATASET-003B P1 涨停口径修复 + 重建 `ds_*` 仍未执行** → 当前 `ds_*` 为旧口径（封板样本系统性漏判 ≈38.03%），RESEARCH-002 只证明「引擎可用」，**基于其上不得产出任何策略结论**；`liquidity_daily.totalMarketCap`/`circulationMarketCap` 全 NULL（依赖市值/流通盘的特征恒 null）与 industry `effectiveFrom` 单点（`industry` 维度绝大多数不可用）为上游待修；v1 窗口仅 1 个月且仅主板 → 时间/板块稳定性无法评估，需构建跨年跨板块 Dataset Version；`time_to_target`/`time_to_stop` 因 Dataset 无交易规则而**刻意不实现**；`regime` 维度需接入 `marketRegime22` 作为合法 `RegimeTagProvider`。**工程债**：Drizzle 无外键且 `delete` 不级联 → 删 Experiment 留孤儿（E2E 脚本已 leaf-first 手动清理，产品化需补级联）；`research_experiment` 与 legacy `research_experiments` 仅差一个 s，长期混淆风险。更新 §44 头部快照 + §44.5 队列（9 → 已完成，新增 10/11）。

- **2026-09-11 18:35 GMT+8 — WORK RESEARCH-002 前端工作台交付（引擎消费侧，明确不触碰 Dataset 侧）**。用户决策「下一步做 Research 前端工作台 + 不要管 dataset 那边」。在已就绪的 17 个 `researchEngine` tRPC 端点之上构建完整浏览/触发/查看工作台，**`ds_*` 未重建、DATASET-003B P1 未启动**（遵用户指令，亦不动 §44.5 第 10 条硬门槛）。**分层**（§17 前端约定 `API(DTO) → Adapter → ViewModel → UI`，UI 不直接消费 DTO、不在 JSX 强转）：`client/src/adapters/researchEngineAdapter.ts`（唯一展示契约层，~600 行）；`client/src/components/research/`（表单纯函数 `createExperimentForm.ts`/`createAnalysisForm.ts` + 6 个展示组件 + barrel）；`client/src/pages/research/`（`ResearchList` + `ResearchDetail` 4 Tab 工作台）；路由 `/research`、`/research/:experimentId`；`AppShell` 加「研究实验」入口（`FlaskConical`）。**三条「不造假」防线**（有单测锁定）：① 指标单位二义性（`MEAN` 在 `turnover` 是 %、在 `market_cap` 是绝对数、在 `days_to_breakout_5d` 是「天」）→ `metricUnitOf(code, variableName)` 先查自单位码表、否则按变量名判定、**判不出返回 NUMBER 绝不猜**；② 缺失指标 `metricValue=null` → `formatMetricValue` 一律渲染 `—`、**绝不 fallback 到 0**；③ 同组内各指标样本数**合法地不同**（`MEAN_RETURN` n=1065 vs `MAX_DRAWDOWN` n=1127）→ 分组表**逐指标**保留各自 `n=`，仅权重一致时才给统一 `uniformSampleCount`、否则显琥珀徽标「各组分母不一致，逐指标标注样本数」。**类型安全枚举镜像**：`as const satisfies ReadonlyArray<{value: ResearchType…}>` 让后端枚举一变前端编译期即失败（防静默漂移），`primaryPriority` 显式镜像后端 `PRIMARY_PRIORITY`。**诚实降级清单**：不可用 Dataset Version 可见但禁用（标真实状态如 BUILDING，不悄悄过滤）、`PARTIALLY_SUPPORTED` 渲染 warning 不渲染 success（落全局色表 `client/src/lib/status.ts`，§12 禁页面自带颜色）、分析级 `notes` 从 `evidence.contributingAnalyses[].notes` 取（该字段不单独持久化，UI 只在结论面板呈现，不假装分析页有数据）、12 个引擎错误码 → 可读诊断、Run 失败显式展示 `errorCode`/`errorMessage`。**顺带修复后端真实缺陷**（构建消费侧时反向暴露，见 §16.5）：`server/researchEngine/conclusion.ts` 的 `evidence` 在两个分支下形状不一致（无主分析分支手写 `{disclaimer,policy,trace,analyses}`、主分支写 `{…,ruleTrace,contributingAnalyses}`）→ 下游需两套解析器 → 抽出单一构造入口 `buildEvidence()`、`primary: null` 表「本次无主分析」而非键缺失 → `conclusion.test.ts` 加回归断言两分支键集相同（该文件 12 例全过）。**验证**：`npx tsc --noEmit` **exit 0**；前端新增 **3 文件 73 例全过**（adapter 26 + createExperimentForm 16 + createAnalysisForm 31）；全链路聚焦（引擎 + 前端 + datasetRegistry + researchCore + shared）**32 文件 / 577 例全过**；`npx vite build` **RC=0**（✓ 2983 modules transformed）；**全量 vitest 197 文件 / 2913 例**（2897 通过 / 16 失败）——相对实施前 **+3 文件 / +74 例**，**失败数恒为 16、失败文件恒为同样 8 个既有环境依赖文件**（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `researchRunRouter` / `tushare.secret` / `tushareTradingCalendar`）→ **零新增失败**；生产 bundle grep 服务端专有标识（`engineAssert`/`FEATURE_VARIABLES`/`PIT 安全特征`/`neweyWestMeanTStat`/`ds_first_limit_pullback`）**全部未出现**（无服务端运行时代码泄漏）；真实 DB 只读契约核对脚本 `scripts/checkResearchWorkbenchApi.mts` **24/24 PASS**（含「`future_return_{h}d` 覆盖 path 全 1~20、聚合类结果变量**不为** outcome 未覆盖的视界发明、`unavailableDimensions` 显式列 regime 及原因、不存在的 Dataset Version → NOT_FOUND」等不虚构不变量；`createCaller` 只读调用、零写入）。**产物**：`docs/research/RESEARCH-002-report.md` 新增 §16（8 小节）并同步 §11.1/§11.3/§11.4/附录 A；ROADMAP §44.5 第 9 条加 9b 子项。更新 §44.5 队列 + §47 append。

- **2026-09-11 19:05 GMT+8 — WORK 龙头候选池页面性能修复（分页 + 磁盘快照；统计口径零变更，遵用户「保持全部历史」）**。用户报告「龙头候选页面现在也因为数据太多卡住，无法渲染了，尽量少用脚本跑测试（DB 数据太多，很浪费时间）」。**第一步是实测而非猜（一个临时探针，分阶段打印，跑完即删）**：`getLeaderCandidates()` = **28,819 ms**（全表 99,577 条 `limit_up_records` + 情绪周期 + 当日价格）；`loadBacktestBaseContext({})` 全区间 = **196,167 ms**，其中 **99,577 条涨停记录 → 1,524,646 行价格行**（每股涨停日 ±44 自然日窗口的并集）、1,863 交易日；`getLeaderCandidateBacktest({observationDays:1})` 全链 = **304,900 ms**；明细 **3,463 行 / 3,155,000 B**，整个结果 JSON **5,528,178 B**，`trades` 3,056 笔（**第二次复核测得 10,336 行 / JSON 10.83MB / `trades` 1,213 —— 差异原因已定性为「另一会话并发改动候选生成」，见本节验证段**）。**结论修正了我先前的估算**（曾以为明细约 5 万行/30MB，实测 3,463 行/3.15MB）→ 病根是**页面 5 分钟不出内容**（外加 5.5MB 一次性序列化），不是 DOM 撑爆；成本几乎全在**跨境传输 152 万行价格行**。**用户决策：保持全部历史、只做分页**（明确不改统计口径/窗口）→ 本轮**不引入窗口参数、不动任何统计口径**。
- **交付 1（服务端分页 + 载荷裁剪）**：新 `server/leaderCandidateHistory.ts`（纯函数、无 IO）——`paginateLeaderCandidateHistory` / `filterLeaderCandidateHistoryRows` / `stripLeaderCandidateHistory`；契约：页码与页长夹取（上限 200）、**越界夹取到末页**（数据收缩后不出现空白页）、`totalRows` 恒为**筛选后**全量而 `allRows` 为未筛选全量、无过滤参数走**零拷贝快路径**、**不重排**（保持上游「候选日期倒序 → 评分降序」）；`db.getLeaderCandidateHistoryPage` 复用同一份回测结果缓存**只在服务端切片 → 翻页不重算**；`routers.ts` 的 `getLeaderCandidateBacktest` 改为 `stripLeaderCandidateHistory(...)`（**不再回传 `historicalRows`**，改回传 `historicalRowCount`），并新增 `sentiment.getLeaderCandidateHistoryPage`（`page`/`pageSize`/`phase`/`onlySuccess`）；顺带把 `sentimentCycle.ts` 的阶段列表抽为 `SENTIMENT_CYCLE_PHASES` 作为**唯一权威顺序**，zod schema 与阶段漏斗 `phaseOrder` 共用（消除字面量漂移）。
- **交付 2（明细磁盘快照，解决 5 分钟等待，不改任何计算）**：新 `server/leaderCandidateBacktestSnapshot.ts`——`.cache/leader-candidate-backtest/<stableHash(options)>.json`，TTL **6h**、只落盘 ≥256KB 的「昂贵」结果、**原子写（tmp + rename）**、最多保留 6 份（按 mtime 淘汰）、**任何 IO/解析失败一律静默降级为未命中且绝不上抛**（缓存故障不得变成页面故障）；`getLeaderCandidateBacktest` 读取顺序改为 **内存(30min) → 磁盘(6h) → 重算并落盘**，使进程重启（dev 下 `tsx watch` 频繁重启）后仍免重算。
- **交付 3（失效 = 正确性修复，非纯性能）**：新增 `db.invalidateLeaderCandidateBacktestCaches()`，挂在 **8 处写入之后**（`createLimitUpRecord` / `createLimitUpRecordsBatch` / `updateLimitUpRecord` / `deleteLimitUpRecord` / 批量改代码 / `upsertStockDailyPrices` / `upsertSuspensionWindows` / `deleteSuspensionWindow`）清空内存 + 磁盘快照 —— **顺带修掉一个既有真实缺陷**：此前上传新涨停数据后，30 分钟内存缓存会继续回传旧数字。并新增 `backtestCacheGeneration` 数据版本号：一次耗时数分钟的计算若**横跨了数据写入**（结果可能基于半同步数据）→ **只回传、不写缓存**，避免把中间态固化进内存与磁盘。
- **交付 4（前端）**：新 `client/src/components/CandidateHistoryTable.tsx`（只渲染服务端返回的当前页；行类型直接 `inferRouterOutputs` 自 tRPC 防字段漂移；加载/错误/空态 + 重试）与 `client/src/components/PaginationBar.tsx`（首/上/下/末页 + 页码省略号 + 每页条数 + 「第 x / y 页」）；`LeaderCandidates.tsx` 的阶段筛选从「前端过滤整份明细」改为**服务端参数**（筛选/窗口/阈值/页长变化自动回第 1 页）、`placeholderData: keepPreviousData` 翻页不闪、刷新按钮同时刷新明细；**删掉 4,129 字符的巨型单行表格 JSX**。
- **验证（遵「少跑脚本」：以零 DB 依赖的聚焦测试为主）**：`npx tsc --noEmit` **exit 0**；新增 **3 文件 / 28 例**（`leaderCandidateHistory.test.ts` 12 + `leaderCandidateBacktestSnapshot.test.ts` 11 + `leaderCandidatesPage.test.ts` 5 源码级防回归）；聚焦套件 **6 文件 / 63 例全过，实测 2.75 s（不连库）**；既有 `leaderCandidates.test.ts`(19) 与 `strategy/productionIntegration.test.ts`(14) 保持全绿（后者断言 `historicalRows` 仍在**核心结果**中 —— 本轮只裁剪 **router 响应**，核心函数形状未变，故不需改测试）。真实 DB 验收 `scripts/verifyLeaderCandidateHistoryPaging.mts`（一次性，兼作快照预热）：**全项 PASS** —— 冷调用 **413.4s**（比首次探针 305s 更慢，属跨境 DB 波动）；`totalRows = allRows = historicalRowCount = 10,336`、207 页（pageSize=50）；**单页响应 46,909 B（46.9KB）** vs **全量 10.83MB** → 剥离明细后 **1.30MB**（响应体积降 ≈230×）；翻页 **0ms**（命中结果缓存）且与第 1 页**重叠 0 行**；**越界页码 99999 → 夹取到 207/207** 并返回末页 36 行；**阶段筛选「冰点试错」totalRows=0 → 如实返回 0**（不编造）；**磁盘快照命中 true 且含 10,336 行**（`.cache/.../json` 11,353,097 B，18:57 生成）；回测参数回读 `appliedMinScore=45` / `recommendedMinScore=45` / `calibrationSampleSize=523` / `trades=1213`。⚠️ **行数与首探针不同（3,463 → 10,336）已定性：不是本修复所致** —— 期间工作区被**另一会话并发改动**（`git diff --stat HEAD`：`downsideRisk.ts` 未提交 **248 行**、`leaderCandidates.ts` **109 行**，内容为「高位连板风控 `maxParticipatingBoards` / `boardHeightRiskContribution` / `positionScale`」；`downsideRisk.ts` mtime **18:50:41** 恰落在验收运行途中，且首次 tsc 曾报随后自行消失的 `Property 'maxParticipatingBoards' does not exist` —— 即类型与用法被分批写入）。本修复只裁剪 **router 响应**，未触碰候选生成/评分/校准，两者正交。
- **遗留（明确未做 + 原因）**：① **首次**全区间计算仍需 **≈305s**（实测地板 = 152 万行价格行跨境传输 ≈196s）—— 用户选择不改窗口，故首次打开需等一次，之后 6h 内（含进程重启）走快照秒回；② 真正的 10× 提速要把价格窗口从「全部 99,577 条涨停记录」收窄到「可成为候选的记录」（3,463/99,577 = 3.5%），但 `server/strategy/strategyBacktest.ts` 第 3 步用 **`rawRows` 的日期并集**推导 `startDate`/`endDate`（再与 `context.tradingDates` 求并集后按该区间过滤），收窄价格行**可能裁剪最早候选的回溯窗口**（SMA20 等特征）→ **必须做前后 A/B 逐字段对比才能改**，本轮风险高于收益，**未做**；③ `getLeaderCandidates()` **28.8s** 仍在页面关键路径（页面骨架要等它），改法涉及「有界回看」属口径边界 → 需单独评审；④ `StockSync.tsx` 仍内联一套分页控件，后续可改用 `PaginationBar` 去重。**§44 无数据快照变更**（纯应用层代码，DB 结构与数据零改动）。

- **2026-09-11 19:15 GMT+8 — WORK RESEARCH-002A 引擎维护层 + 工作台可维护性交付（范围 A；D 段未开工）**。用户指令：「不要管 dataset 功能与数据，需要你把研究模块完成，现在还缺哪些」→ 先做**证据化缺口审计**（以代码/schema 为准，不采信文档文字），再经确认选定范围 **A（引擎 CRUD + 工作台可维护性）+ D（运行闭环 executor 装配）**，数据边界为「**只写代码用既有接口，不碰 `ds_*` 与 dataset 页面**」。本次交付 A。
- **缺口审计（证据）**：`server/researchEngineRouter.ts` 17 端点**零 update/delete**；`server/researchCore/repository/contract.ts:151-239` 早已定义 `update`/`delete`/`replaceForAnalysis`/`deleteByAnalysis` 但**无一可经 API 到达**；级联删除规则**仅存在于** `scripts/verifyResearchEngine.mts#cleanupExperiment`；`setAnalysisConditions` 原语义只替换条件行、**不清旧结果** ⇒ 界面继续展示「按旧口径算出的数字」（**静默不实**，比抛错更危险）；`researchRunRouter.ts:114` `executorBound = false` 硬编码 ⇒ 「策略→跑研究」断链；FE-4 运行工作台为 `emptyRunResult()` 占位；前端零导出/零删除/零条件编辑；`listCandidates` 无消费方。
- **交付（服务端）**：新增 `server/researchEngine/maintenance.ts`（**465 行**）——`deleteRunCascade` / `deleteExperimentCascade` / `deleteAnalysisCascade` / `deleteHypothesisCascade` / `invalidateAnalysis` / `replaceConditionsAndInvalidate` / `describeDeletionCounts`；`researchEngineRouter.ts` 428 → **588 行**，**17 → 25 端点**（**+7 维护端点**，全部 `adminProcedure`）；`types.ts` + `DELETE_CONFLICT`；错误映射 + `HYPOTHESIS_NOT_FOUND`/`ANALYSIS_NOT_FOUND` → `NOT_FOUND`、`DELETE_CONFLICT` → `CONFLICT`。
- **两条诚实性设计（本次核心）**：① **结论归属不可猜**——`research_conclusion` **无 `runId`**，故从 `evidence` **精确提取 `analysisId`**（`primaryAnalysis.analysisId` ∪ `contributingAnalyses[].analysisId` ∪ 旧键 `analyses[].analysisId`）与被删 Run 的分析集合求交；**提不出 id 就不删**并计入 `unattributedConclusions`，前端如实回显「另有 N 条结论无法判定归属，已保留」。形状不认识 → 返回空数组，**不做 `?? 0` 兜底**。② **改口径 = 让旧产物失效**（守卫 → 替换 → 删旧结果 + 删失效结论 + Analysis/Run **回退 `PENDING`**）；回退 `PENDING` 让既有 `runEngine` 的 `RUN_NOT_PENDING` 前置**恰好放行重跑** ⇒ **无需新增重跑入口**（表面积更小且与既有状态机自洽）。另：`RUNNING` 时删父行会产出幽灵行 → `DELETE_CONFLICT` 显式拒绝。
- **交付（前端，沿用 adapter 分层、不在 JSX 强转）**：新增 `ConditionGroupsEditor.tsx`（共享条件组编辑器，从 `CreateAnalysisDialog` 抽出）、`ConfirmDeleteButton.tsx`（**不做任何数据推断**：后果由调用方按后端语义给出、删完回显服务端真实计数）、`ExperimentActions.tsx`（重命名 + 级联删除；**不提供换数据集入口**——schema 中根本没有 `datasetVersionId` 键）、`AnalysisConditionEditor.tsx`（回填 → 校验 → 替换 → 如实回显「清除 N 行 / 删除 M 条结论 / Run 回退 PENDING」）、`CandidatesPanel.tsx`（**诚实空态**：讲清「引擎不做自动策略生成，所以通常为空」，避免用户以为自己漏了步骤）；`createAnalysisForm.ts` + `conditionGroupsToPayload` / `conditionPayloadToDraftGroups` / `validateConditionGroups`（**新建与编辑共用同一载荷构造器**）；`ConclusionPanel.tsx` + 结论 JSON 导出（显式标注 `exportKind: "CLIENT_SIDE_API_SNAPSHOT"`，是接口响应快照而非报告）；`ResearchDetail.tsx` + 实验操作 / Run 删除列 / 分析「编辑条件 + 删除」列 / 策略候选 Tab。
- **顺带修掉一个真实缺陷（§11.4 第 8 项）**：`conditionGroupsToPayload` 原用**草稿下标**当 `groupNo`，而「整组一字未填」的空组不产出任何行 ⇒ 空组在**前/在中**时载荷**组号断号**（如只含 `groupNo:1` 而缺 0），被 `server/researchCore/conditions.ts:181-183` 的 `assertConditionSet`（要求**组号唯一且连续 0..n-1**；写库路径 `repository/db.ts#replaceForAnalysis:649` **真会调用**）直接拒。**可达性**：新建 CONDITIONAL 分析（默认第 1 组为空）后先去填第 2 组再保存即触发。**修法**：按**有效组**重排连续 0..n-1，组内 `sortOrder` 按有效条件紧凑编号（后端只要求组内唯一）。**附带收益**：紧凑化使「草稿→载荷」与「载荷→草稿」互为规范形 ⇒ **往返幂等**（用户「打开编辑、不改、保存」不改动库里任何口径）。⚠️ **原测试把错误行为写成了期望**（`expect(rows[0]).toMatchObject({ groupNo: 1 })` 配一个空的第 1 组）——已改正为 `groupNo: 0` 并注明原因；这类「测试固化缺陷」会让修复看起来像回归，值得警惕。
- **边界（明确未做）**：**零数据依赖** —— 无迁移、无回填、无 Dataset 重建；**未触碰 `ds_*` 物理表与 dataset 页面**；**未修改** `docs/researchReadyGate/research_ready_gate.json`；**未做** 运行闭环（executor 装配 / readiness 真实探测 / FE-4 接线）→ 见 §44.5 第 9d 条。
- **验证**：`npx tsc --noEmit` **exit 0**；`server/researchEngine/maintenance.test.ts` **19 例**（新增）、`server/researchEngineRouter.test.ts` **29 例**（含 7 端点契约 + 维护端点鉴权 + 「替换后旧产物失效」改写）、`client/src/components/research` **60 例**（`createAnalysisForm.test.ts` 31 → 44 例，含往返幂等 + 组号连续性）；聚焦全链路 `vitest run client/src/components/research client/src/adapters server/researchEngine server/researchEngineRouter.test.ts server/researchCore` → **19 文件 / 326 例全过**；`npx vite build` **RC=0**（2995 modules）；全量 `npx vitest run` → **204 文件 / 3010 例**（2994 通过 / 16 失败），**失败文件与 §11.3 基线逐字一致（同样 8 个环境依赖文件）⇒ 零新增失败**（文件总数 197→204 的差额来自本段之外的并行工作流：board-height 风控 / leader-candidate / backtestPage 等测试文件）。
- **🔴 同期发现（部分已消解，1 项遗留待裁）**：`docs/researchReadyGate/research_ready_gate.json`（capturedAt **2026-09-09T15:07:48Z**）实为 **`researchReady = true`**（G0 PASS / G1 GAP / G2 PASS / G3 GAP / **G4 PASS** / G5 GAP，`pendingChecks = []`），**推翻** §44 此前「RESEARCH_READY=FALSE 期间」表述。**19:45 更新**：`server/researchRunRouter.test.ts` 一侧**已随 D 段落地消解**（原 `verdict=DATASET_NOT_READY` 断言是对数据状态的错误预期；该文件已重写为 17 例，含一例显式漂移探测器，断言 `researchReady=true` + `verdict=EXECUTOR_NOT_BOUND` 并注明「失败即应同步更新 ROADMAP，而不是改回断言」）。`server/dataHealth.test.ts`（断言 `G4=GAP` / `researchReady=false`）**仍 1 例失败未修**——属数据域治理范围，**未改快照、未改期望**（二者都属「用动作掩盖状态」），待裁定「重跑认证 → FALSE」还是「更新期望」。

- **2026-09-11 19:45 GMT+8 — WORK RESEARCH-002A(D) 闭环装配 + readiness 真实探测 + 闭环运行端点 + 运行工作台交付（范围 D；D 段收口）**。承接同日 A 段（引擎维护层），按用户确认范围完成 **D（运行闭环）**，数据边界仍为「**只写代码用既有接口，不碰 `ds_*` 与 dataset 页面**」。
  - **D1 · 闭环 stage executor 装配**：新建 `server/research/closedLoopWiring/`（`types.ts` / `requirements.ts` / `coverage.ts` / `executors.ts` / `index.ts`，测试 **31 例**）。**14 阶段装配声明表是唯一权威**，每个「未装配」阶段写明**缺什么 + 为什么现在不装 + 真实入口坐标**。已装配 **6**：`data`/`research`/`strategy`/`backtest`/`evaluation`/`finalize`；留白 **8**：`optimization`/`robustness`/`oos`/`overfitting`/`regime`/`paper`/`review`/`discipline`（`regime` 最易补齐）。**只调真实模块**（`runCandidateEngine` / `createStrategyDocument` / `runTradeSimulation` / 三套 `evaluate*`），交接摘要全部**投影自真实产物**并复用既有适配器（`summarizeTradeSimulationRun` / `composeClosedLoopEvaluationRef`），缺前置产物抛 `ClosedLoopWiringError` **响亮失败**、绝不返回占位摘要。**注册策略 = 只为「真的能跑」的阶段注册** ⇒ `stageRunners` 表本身就是一句实话。
  - **🔴 D1 测试抓出的真实设计缺陷（已修）**：入参来源原设计「来源之间 OR、**来源内也 OR**」⇒ `research` 阶段只要拿到 `dataset` 产物、**即使缺** `experimentConfig`/`strategyContract`/`strategy13` 也会被注册，直到运行期才抛 `CL_WIRING_INPUT_MISSING`——即**把「缺配置」伪装成「执行失败」**。修为**来源之间 OR、来源内 AND**（`ClosedLoopInputSource { inputs?, artifacts? }`），同步改 `requirements.ts`/`coverage.ts`/`executors.ts`，并补 **3 例回归**（有产物缺入参 / 有入参缺产物 / `evaluation` 多来源 OR 仍成立）。
  - **D2 · readiness 真实探测 + 闭环运行端点**：`server/researchRunRouter.ts` 的 `executorBound` 从硬编码 `false` 改为 `assessClosedLoopWiringCoverage({})` 的真实结果（readiness 与 loopRun **共用同一探测函数**，避免两处口径漂移），新增 `wiring` 明细字段；未就绪措辞改为**点名哪 8 个阶段尚无执行器**。新增 **`researchRun.loopRun`**（mutation，**无状态**：不写库、不落 run 记录）：接受调用方显式声明的真实入参（`stageIds` / `evaluationInput` / `backtestSummarySeed` / `lifecycle`），经 `createClosedLoopWiring` 装配后真实调用 `runClosedLoop`，返回 14 阶段轨迹 + `chainFingerprint` + 装配覆盖。**两条防伪绑定**：① `evaluationInput` **必须与** `backtestSummarySeed` 成对（`backtestFingerprint` 只取 `seed.fingerprint`，不接受调用方另填——曲线必须声明来自哪次真实回测，且 evaluation 阶段本就需要 `backtestSummary` 交接）；② `backtestSummarySeed` 与链内 `backtest` **互斥**（冲突即 `BAD_REQUEST`，**不静默丢种子**）。**明确边界**：`wiring` 摘要表达「执行器已装配 ∧ 闭包入参可得」，**不含编排器上游交接可得性**——后者以 `stages[].blocked` 为准（已在代码注释与本条中双处声明）。
  - **共享契约**：`shared/researchContracts.ts` 增 `CLOSED_LOOP_STAGE_ID_VALUES`（**契约单测**断言与后端 `CLOSED_LOOP_STAGE_IDS` 逐项一致，杜绝双份漂移）+ `closedLoopWiringSummarySchema` / `closedLoopDateRangeSchema` / `closedLoopBacktestSummarySeedSchema` / `closedLoopLifecycleInputSchema` / `closedLoopRunInputSchema` / `closedLoopRunResultSchema`；readiness schema 增 `wiring`。因「readiness 需要 wiring summary」而「run input 需要 metrics schema」，区块按**依赖顺序**拆分（装配摘要前置 / 运行 DTO 后置），已修正 3 处 block-scoped 前向引用。
  - **D3 · FE-4 运行工作台真实接线**：新增 `client/src/adapters/closedLoopRunAdapter.ts`（**零计算**：评估标量只从 `evaluationRef` 直搬，缺字段一律 `null`；`buildClosedLoopRunViewModel` 对非对象/无 runId 返回 `null`；未知阶段状态降级 `UNKNOWN`；`deriveExperimentId` 确定性派生 §28 标识符，**非业务数值**）+ `client/src/components/strategy/ClosedLoopRunResultPanel.tsx`（全链概要 / 评估标量 / 装配覆盖 / 14 行逐阶段轨迹含阻塞 reasonCode 与详情）。`RunConfigPanel` 增 `onRun`/`running`/`runError` 三 prop，**「运行策略」按钮不再因 `executorBound=false` 锁死**（点击发起的是**真实执行**：入参齐备的阶段真跑、其余如实 BLOCKED，具诊断价值），未就绪原因仅 Tooltip 提示、不阻断；`RunWorkbenchTab` 由 `emptyRunResult()` 占位改为真实接线（`emptyRunResult` 现仅用于「尚未发起」空态）。`client/src/lib/status.ts` 补闭环语义色（`EXECUTED`/`BLOCKED`/`ALL_EXECUTED`/`PARTIAL_BLOCKED`/`NO_STAGE_EXECUTED`）。
  - **验收（全部实跑）**：`npx tsc --noEmit` **exit 0**；`closedLoopWiring.test.ts` **31 例**、`researchRunRouter.test.ts` **17 例**（原 2 例 → 17 例）、`closedLoopRunAdapter.test.ts` **17 例**（新增）；`client/src` 全量 **10 文件 / 172 例全过**；聚焦批次（`researchRunRouter` + `closedLoopWiring` + `dataHealth` + `researchEngine` + `researchCore` + `researchEngineRouter`）**17 文件 / 276 例**，**唯一失败**为 §44 已记录的 gate 快照冲突（`dataHealth.test.ts`，非本次引入）；`npx vite build` **RC=0**（2995 → **2997 modules**）。
  - **边界（明确未做）**：**零数据依赖** —— 无迁移、无回填、无 Dataset 重建；**未触碰 `ds_*` 物理表与 dataset 页面**；**未修改** `docs/researchReadyGate/research_ready_gate.json`；**未修** `dataHealth.test.ts` 的 gate 期望（属数据域治理，待裁定）。
- **报告同步**：`docs/research/RESEARCH-002-report.md` + §17（9 小节）+ §11.3 复核注 + §11.4 第 8 项指引 + 附录 A/B/C（附录 C = 本段边界声明）。
- **2026-09-11 20:35 GMT+8 — WORK RESEARCH-002B 增量补跑单个分析交付（功能真实缺失补齐；零数据依赖）**。用户实报两个问题：①「研究实验模块，我新建了一个 run，为什么迟迟没有结果」；②「我执行了一次分析，后面又新建了一个分析，但是没有可以让他运行的按钮」。**诊断（以代码/DB/日志为证，不采信文档文字）**：① `server/researchCore/repository/db.ts#createRun` 注释即写明「**只创建，不执行**」，真正执行入口只有 `researchEngine.runEngine`（`engine.ts`），而**服务端不存在任何消费 PENDING Run 的后台 worker/cron**（`server/` 内全部 cron 属 marketSync / paperTrading / heartbeat），且新建 Run 默认零分析会让「运行引擎」按钮**恒灰** ⇒ **空 Run 永远不会自己出结果**（数据侧无问题：`dataset_version 390001` = READY、1130 事件、60002 行）；② Run 一旦 `COMPLETED`，**双侧 `RUN_NOT_PENDING` 守卫**（前端 `RunEngineButton.tsx#executable = PENDING|FAILED|CANCELLED`、后端 `engine.ts:119`）使「运行引擎」恒灰；而「新建 Run 重跑」这条路**走不通** —— 分析以 `runId` 挂载、无任何跨 Run 继承能力、`updateAnalysis` 的 patch 白名单**不含 `runId`** ⇒ **「给已完成 Run 补跑新增分析」是真实缺失的能力，不是配置/操作问题**。**用户拍板两项**：语义 = 「**允许增量补跑单个分析**」；执行方式 = 「**先不用代跑，我自己在页面上点**」。**三条硬约束（先论证后实现）**：① 增量**必须复用 Run 已冻结的基准**（`inputSnapshot` 内 `datasetVersionId` + 日期窗口），否则新老分析落在不同样本集上、数字**不可比**——决定性依据是 `sampleSet.ts#buildSampleSet` **不按条件过滤事件**（已全文复核：事件集只由「datasetVersionId + 日期窗口」决定，分析变量仅作**投影列**），故增量**并上**目标分析的新变量**不会改变样本集**；② 增量**不得生成结论**，且此约束**可证明**而非保守——`AnalysisSummary`（effect/pValue/tStat/…）**未落库**、`diagnostics` 明确不写入 `result_json`，故**无法重建被跳过分析的历史摘要**，用部分摘要拼结论 = **编造**；③ `inputSnapshot` **不可变**（RESEARCH-001 定死「执行时落定、事后不得修改」）⇒ 增量事实**必须另立追加式载体**，不得改写快照。**服务端实现**：新增 `research_run.executionLogJson`（`drizzle/0032_research_run_execution_log.sql`；头部含「为何必须有此列 / 追加式语义 / 版本边界不 backfill」长注释）+ `scripts/applyResearchRunExecutionLog.mjs`（apply + **17 项断言**：列存在/longtext/可空 + 12 个既有列仍在 + **行数与逐行数据不变**；支持 `--dry-run`/`--check`，幂等；**不写 `_journal.json`** —— 项目自 0024 起停止维护、手工补写属伪造）。新增 `server/researchCore/executionLog.ts`：`assertResearchRunExecutionLog`（**非法结构响亮失败，绝不降级成 `[]`**）/`parseResearchRunExecutionLog`/`nextExecutionSequence`（规则：`max(sequence)+1`；**日志空但快照存在 ⇒ 2**，因批次 1 已被历史的整轮执行占用、**不 backfill**；两者皆无 ⇒ 1）/`appendExecutionLogEntry`（返回新数组、重复 sequence 抛错）/`settleExecutionLogEntry`（只收敛终态、不新增）。`server/researchEngine/engine.ts` **抽出 4 个共用私有核心**（`buildCatalog`/`loadConditionSets`/`resolveAnalyses`/`executeAnalyses`）+ 纯函数辅助（`unionRequirementOf`/`mergeRequirements`/`readSnapshotBasis`/`selectRunnableAnalyses`），使既有 `run()` 与新增 `runIncremental()` 共用同一套执行路径；`run()` 现在**同时写批次 1（mode=FULL）**、失败时 `settleExecutionLogEntry(status:"FAILED")`。`runIncremental()` 流程：读快照基准 → **断言 `basis.datasetVersionId === experiment.datasetVersionId`**（否则 `DATASET_VERSION_DRIFT`，防在漂移的数据集上续算）→ 选可跑分析（`PENDING|FAILED|CANCELLED`）→ 变量需求 = `mergeRequirements(快照基准变量, unionRequirementOf(已解析分析))` → 用**快照日期窗口**（非当前配置）`buildSampleSet` → `executeAnalyses` → **不建结论**（返回 `conclusionId: null` + `conclusionSkippedReason`，文案 `INCREMENTAL_CONCLUSION_SKIPPED_REASON` 写明可证明原因）→ Run 终态由「是否仍有未完成分析」决定（`allCompleted ? "COMPLETED" : "PENDING"`），Experiment 同规则（否则保持 `previousExperimentStatus`）。新增 `researchEngine.runIncremental` 端点（`adminProcedure`，入参 `experimentId`/`runId`/`analysisIds?`）+ 4 类错误码映射（`RUN_ALREADY_RUNNING`/`ANALYSIS_NOT_RUNNABLE`/`NO_RUNNABLE_ANALYSES`/`DATASET_VERSION_DRIFT` → CONFLICT；`RUN_SNAPSHOT_MISSING` → PRECONDITION_FAILED；`ANALYSIS_NOT_IN_RUN` → BAD_REQUEST）。`maintenance.ts#deleteOneAnalysis` 加注释**显式声明刻意不清理** `executionLog` 中悬空的 `analysisId`（append-only 历史事实纪律）。**前端实现**（沿用 `API → Adapter → ViewModel → UI` 分层，不把裸快照漏给视图层）：`client/src/components/research/incrementalRunForm.ts`（补跑门禁纯函数 `isRunnableAnalysisStatus`/`isRunBusy`/`incrementalAvailability`/`countRunnableAnalyses`；判定优先级 RUNNING → 状态不可补跑 → 无快照（引导去点「运行引擎」））；`RunIncrementalButton.tsx`（分析行内「补跑」按钮：禁用原因 Tooltip + 执行证据弹窗 + **明示「本批次未生成结论」**琥珀提示块；成功后失效 `getAnalysisResults`/`listConclusions` 缓存）；`RunExecutionBatches.tsx`（Run 卡片「执行批次」表；**空日志时如实说明版本边界** ——「此前的整轮执行只体现在执行快照里」，并导出 `skippedConclusionNotes()`）；`researchEngineAdapter.ts` 增 `RunExecutionBatchVm`/`toExecutionLogVm()`（防御性归一）与 `RunRowVm.hasInputSnapshot`/`executionLog`；`RunEngineButton.tsx` 增 `runnableAnalysisCount`，**Run 已 COMPLETED 且存在待补跑分析时不再只说「已完成」，而是直接指向行内「补跑」**（改用 `Tooltip` 替代原生 `title`）。**刻意保留的诚实边界**：① 增量**不产结论**（原因内嵌在返回体与 UI）；② 空 Run 仍需用户主动点「运行引擎」（**没有**引入后台自动消费，避免悄悄改变既有语义）；③ 日志空 ⇒ 下一批从 **2** 起（**不回填**历史批次）；④ 删分析后日志中的悬空 id **不清理**（历史事实）。**验证**：`npx tsc --noEmit` **exit 0**（多次）；新增测试 **3 文件 / 44 例全过**（`server/researchCore/executionLog.test.ts` **18** / `server/researchEngine/engineIncremental.test.ts` **14**（6 个 describe：正常补跑 / 复用冻结基准 / 批次日志 / 结论 / 拒绝非法目标 / 失败路径与可重入）/ `client/src/components/research/incrementalRunForm.test.ts` **12**）；`server/researchEngineRouter.test.ts` **29 → 32 例**（新增增量端点契约 3 例 + 端点清单 + anon 鉴权拒绝）；**共用核心抽出后零回归**：`server/researchEngine` + `server/researchCore` **234 例全过**；聚焦回归（`server/researchCore` + `server/researchEngine` + `researchEngineRouter.test.ts` + `client/src/components/research` + `client/src/adapters`）**23 文件 / 390 例全过**；migration apply **17 项断言 PASS**（幂等重放已验）；**真实 TiDB 端到端验收** `npx tsx scripts/verifyResearchEngine.mts --all` **RC=0（73,511 ms）**，5 类分析全跑、QUANTILE 顶底差 −3.0785% 经**独立复算一致**、证据落 `docs/research/RESEARCH-002-e2e-evidence.json`、**自建自清 9 行**（Experiment 210001 及全部下游实体；**未触碰用户已有的 Experiment 180001 / Run 180001 / 180002**）；**全量 vitest 209 文件 / 3117 例**（3102 通过 / **15 失败**），**失败文件 7 个全部落在既有环境依赖基线集合内**（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`；Tushare token / 网络 / DB / 认证快照），且 **`researchRunRouter` 已随 D 段由失败转通过** ⇒ **零新增失败**。**零数据依赖**：无回填、无 Dataset 重建、**未触碰 `ds_*` 物理表与 dataset 页面**、**未修改** `docs/researchReadyGate/research_ready_gate.json`。**产物**：报告 `docs/research/RESEARCH-002-report.md` 新增 **§19（19.1 触发问题实录 / 19.2 语义选择 / 19.3 三条硬约束 / 19.4 实现清单 / 19.5 状态与终态规则 / 19.6–19.7 验收 / 19.8 未做边界）** + 附录 A 新增/修改文件清单 + 附录 B 复现命令（2f）。更新 §44 头部实查快照 + §44.5 队列（9f）。

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

- **2026-09-10 02:14 — WORK DATASET-002.2 Dataset Registry 只读契约/查询/路由层 CODE_READY（前端 MVP 后端前置）**。新增 `shared/datasetRegistryContracts.ts`（DTO 契约 + zod：`DatasetDefinitionListItem`/`DatasetVersionListItem`/`DatasetBuildJobListItem`/`DatasetStatistics`/`DatasetPage` + `DATASET_PAGE_LIMIT_MAX=200`/`DATASET_PAGE_LIMIT_DEFAULT=50`）、`server/datasetRegistry/query.ts`（keyset 分页查询 + 统计聚合 + `DatasetQueryService`，复用 DATASET-001 领域层）、`server/datasetRegistry/router.ts`（只读 tRPC：listDefinitions/getDefinition/listVersions/getVersion/listJobs/getStatistics/listEvents/listPaths/listOutcomes），挂载 `server/routers.ts` `datasetRegistry` 节点。**纪律**：keyset cursor 不透明字符串原样回传、禁止 OFFSET、禁止全量加载。验证：`vitest run server/datasetRegistry` 56 例全过、`tsc --noEmit` exit 0。§44 无数据快照变更（只读消费，无新数据落库）。
- **2026-09-10 02:14 — WORK DATASET-002.3 Dataset Registry Frontend MVP COMPLETE（4 页 + 5 组件 + adapter + keyset 分页状态机 + 真实 API 验证）**。新增 `/datasets` 四页（DatasetList/DatasetDetail/VersionList/VersionDetail，wouter 路由：`/datasets`、`/datasets/:datasetId`、`/datasets/:datasetId/versions`、`/datasets/:datasetId/versions/:versionId`）+ AppShell「研究数据」组新增「数据集注册」导航；**旧 `/dataset-builder` 与 `researchDataset.*` 完全不动**。5 组件（`DatasetListTable`/`VersionListTable`/`BuildJobTable`/`StatisticsGrid`/`DatasetPreviewTable`）+ barrel，复用 `DataTable`/`StatusBadge`/`Skeleton`/`EmptyState`/`ErrorState`/`TechnicalDetails`/`Tabs`/`MetricCard`（零重复组件）；`status.ts` `STATUS_TONE` 增 6 映射（DRAFT/BUILDING/COMPLETED/CANCELLED/ACTIVE/ARCHIVED）。`datasetRegistryAdapter.ts` 统一 bigint/Date/null/status，JSX 零 `as any`；`datasetPreviewState.ts` keyset 游标栈状态机（`(string|null)[]`：NEXT 压栈/PREV 弹栈/RESET 清残留，limit 20/50/100，version/table/limit 变化即 RESET 防旧数据残留）。单测 23 例（adapter 15 + previewState 8）全过。**真实 API 验证**（`scripts/verifyDatasetRegistryRead.mts` 走真实 TiDB，无 mock）：`first_limit_pullback` 1 定义、smoke/v1/v2 三版本全 READY、v2 实测 eventCount=10,240/pathCount=206,408/outcomeCount=30,720/rowCount=247,368/horizons=[5,10,20]、keyset 两页无重叠顺序递增、1 个 COMPLETED 作业。`tsc --noEmit` exit 0、`vite build` 通过（2977 模块）。产出 `docs/step-dataset-002.3-report.md`（15 节）。**状态 DATASET-002.3 = COMPLETE**；DATASET-002.4 不自行启动。§44 无数据快照变更（纯前端 + 只读 API 消费）。

- **2026-09-10 03:20 — WORK DATASET-002.4A Dataset Registry Build Lifecycle & State Machine COMPLETE（真实 TiDB 22 步验证）**。把 Registry 已有但不完整的 `Definition→Version→Build Job→PENDING→RUNNING→terminal` 补全为完整状态机闭环。**新增** `server/datasetRegistry/lifecycle.ts`（纯函数状态机唯一来源：`VERSION_TRANSITIONS`（DRAFT→BUILDING→READY；BUILDING→FAILED；FAILED/READY→BUILDING 重建，**不臆造 schema 未定义的 CANCELLED/ACTIVE/ARCHIVED**）、`JOB_TRANSITIONS`（5 态 terminal 无出边）、`assertVersionTransition/assertJobTransition`、`isVersionBuildable/isTerminalJobStatus`、`computeBuildProgress`（COMPLETED→100；totalChunks>0→round(ratio) 夹 0..100；信息不足→null 不臆造）、`DatasetLifecycleError` 稳定错误码 6 个）。**重构** `registry.ts` `DatasetRegistryService`：补 `createJob`（PENDING）/`cancelJob`/`retryJob`（FAILED/CANCELLED→新 PENDING 历史保留），修正 `startJob`（PENDING→RUNNING，§六 6 项校验：作业存在/版本存在/作业 PENDING/版本可构建/无另一 RUNNING）、`completeJob/failJob`（仅 RUNNING）、`markBuilding/markReady/markFailed`（加版本迁移守卫）。**并发安全（最小保护，未重构 DB）**：repo 契约增 `transitionJob(id,from,to,patch)`（条件 `UPDATE WHERE id AND status`，返回受影响行=原子防并发重复 start/cancel）+ `getRunningJobForVersion`（版本级 RUNNING 守卫→`JOB_ALREADY_RUNNING`）。**API**：`router.ts` 增 4 admin mutation（createBuildJob/startBuildJob/cancelBuildJob/retryBuildJob），领域错误→tRPC 稳定映射（NOT_FOUND/CONFLICT/PRECONDITION_FAILED），completeJob/failJob 不暴露 client（防伪完成）；`shared/datasetRegistryContracts.ts` 增 4 schema + `DatasetBuildJobListItem.progress`；`query.ts` `toJobListItem` 导出 + 计算 progress。**CLI 对齐** `runDataset001Build.mts` 改 createJob→startJob→markBuilding。**验证**：`tsc --noEmit` exit 0；target tests **112 全过**（lifecycle 13 + registry 18 + router 15 + contracts 11 + adapter 15 + 其余）；`npm run build` PASS（2977 模块）；真实 TiDB `scripts/verifyDataset0024a.mts` **22 步全 ✅**（v2 只读 READY 未动 + 临时版本全生命周期 create/start/progress/dup-start/cancel/retry/fail/complete/并发/历史保留 + 验证后清理无孤儿）；全量 vitest **2498 过 / 16 失败（均既有环境失败：Tushare token/网络、DB 依赖、researchRunRouter 口径，与本任务零重叠）**。产出 `docs/step-dataset-002.4a-report.md`（14 节）。**状态 DATASET-002.4A = COMPLETE**；DATASET-002.5 Research Bridge 不自行启动。§44 无数据快照变更（生命周期验证用临时版本，验证后删除，现有 5 作业不变）。

- **2026-09-10 16:05 — WORK DATASET-002.4B 数据集构建整合（旧 /dataset-builder → 新 Dataset Registry）COMPLETE（真实 TiDB 端到端 21/21）**。把历史上并存的两套数据集构建收敛为一套，**以新 Registry 为准**。**关键突破**：002.4A 只完成了作业状态机，`startJob` 之后没有真正执行构建（真实构建仍靠 CLI）；本次新增 `server/datasetRegistry/runner.ts`（`DefaultDatasetBuildRunner`，~245 行）让 RUNNING 作业**真的被执行并写 ds_\* 物理表**——复用 DATASET-001 `FirstLimitPullbackDatasetBuilder` + `DatasetBuildIO`，零第二套构建逻辑；异步不阻塞请求（`void execute()`）、`running: Map` 幂等、真实 `totalChunks`（窗口交易日数，paths/outcomes 阶段分母=交易日+事件数）、每 chunk 回调落 checkpoint、协作式取消（内存标志，终态由 `service.cancelJob` 落库）、失败落 job+version FAILED（不吞异常）、无构建器诚实失败。**后端新增/修改**：契约层 + `DATASET_VERSION_LABEL_PATTERN`（前后端唯一同源，naming.ts 复用防漂移）+ `DATASET_BUILD_CONFIG_DEFAULTS`（20/[5,10,20]/1000）+ `DATASET_BUILD_CONFIG_LIMITS` + `createDatasetVersionInputSchema`（含 startDate≤endDate refine）；`naming.ts` + `validateVersionLabel`（只校验标签，物理表命名仍只由 dataset_code 决定，禁止一版一表）；`lifecycle.ts` + 4 错误码（DEFINITION_NOT_FOUND/ARCHIVED/VERSION_ALREADY_EXISTS/INVALID_VERSION_LABEL）+ `resolveBuildConfig`；`registry.ts` + `createVersionWithBuildConfig`（定义存在+未归档+标签形态+(datasetId,version) 唯一 → 组装 filterDefinition 落 DRAFT，不让 router/前端拼领域 JSON）；`router.ts` + `createDatasetVersion`(admin) + `buildRunner/buildIO` 注入（start 先 service.startJob 再 runner.start，执行器启动失败则 failJob 不留假 RUNNING；cancel 先落终态再 runner.cancel）；`query.ts` 导出 `toVersionListItem`；`index.ts` 导出 runner；CLI `runDataset001Build.mts` 对齐。**前端**：新增 `BuildVersionDialog`（版本标签建议/日期/高级构建参数/「创建后立即开始构建」→ create→createJob→start 三步编排 + 跳转 VersionDetail）、`VersionBuildControls`（DRAFT/FAILED/READY→开始/重新构建；BUILDING→取消构建；BUILDING 无 RUNNING 作业→诚实提示历史卡态）、`BuildJobTable` + onCancel/onRetry；`VersionDetail` 接控制条 + 作业级取消/重试 + 构建中 3s 轮询（统计 5s，非构建态自动停）；`DatasetDetail` 头部与空态加「构建新版本」入口。**旧构建簇移除（先全库查引用确认仅自引用）**：删 `pages/DatasetBuilder.tsx` + `components/dataset/`（10 文件）+ `adapters/datasetAdapter.ts` + `adapters/buildResultAdapter.ts(.test)`；`App.tsx` 旧路由 → `<Redirect to="/datasets">`；`AppShell` 删旧导航项并把 `/datasets` 更名「数据集构建」（唯一入口）；**legacy `researchDataset.*` 后端保留未删**；**migration 0028 / schema.ts 零改动**。**验证**：`tsc --noEmit` exit 0；target tests **149 全过**（runner 9 + registry 24 + router 20 + contracts 16 + adapter 15 + 其余 65）；`npm run build` PASS（vite 2966 模块，较 002.4A 减 11——删除旧簇；esbuild 1.3mb）；**真实 TiDB `scripts/verifyDataset0024b.mts` 21/21 ✅ exit 0**（真实构建 2024-01-02→01-05：98 events/280 paths/196 outcomes 落库、版本 READY、统计与物理表一致；真实取消 01-02→03-29：CANCELLED + 版本 FAILED + 重复 cancel 拒绝 + retry 新 PENDING 且历史保留；v2 状态/作业数/物理表行数零变化；临时版本验证后清理无孤儿）。全量 vitest **2518 过 / 16 失败（与 002.4A 基线完全相同的 8 个既有环境失败文件：tushare token/网络、marketData/limitUp.watch/limitUp/image DB 依赖、dataHealth 证据分层、researchRunRouter 口径；本任务零新增）**。产出 `docs/step-dataset-002.4b-report.md`（14 节）。**状态 DATASET-002.4B = COMPLETE**；DATASET-002.5 Research Bridge 不自行启动。§44 无数据快照变更（验证用临时版本，验证后物理表行+作业+版本全部删除）。

- **2026-09-10 16:40 — WORK DATASET-003A 多数据集架构 + 版本/数据集删除能力 COMPLETE（真实 TiDB 端到端 44/44）**。需求：「支持构建多个不同的数据集，每个数据集各自拥有多个版本；补充删除数据集版本、删除整个数据集的能力」。经澄清确认两条口径：① 多数据集 = **每个数据集独立表结构与构建逻辑**（拒绝模板复用）；② **删版本 = 删数据保留表结构；删数据集 = 删表结构 + 数据**。**插件化架构（核心）**：新增 `server/datasetRegistry/plugins.ts` —— `DatasetPluginRegistry`（datasetCode → 插件唯一查找：register/get/has/list/unregister）+ `DatasetPlugin`（`physicalTables` DDL 声明 / `createIO` / `createBuilder`）+ `firstLimitPullbackPlugin`（三表 DDL **自包含**，依据真实 `SHOW CREATE TABLE` 编写，不用 `CREATE TABLE … LIKE 模板表` 以免删表后无法重建）+ `resolvePluginTables`；**核心零硬编码 datasetCode**（Registry/Lifecycle/Runner/Router/Query 一律经注册表查找，未注册 → `BUILDER_NOT_REGISTERED` 稳定错误码，不静默回退）。**物理表层**：新增 `server/datasetRegistry/physicalTables.ts` —— `DatasetPhysicalStore` 接口 + `DbDatasetPhysicalStore`（`ensureTables` / `purgeVersionRows`（分批 `DELETE … LIMIT 5000` 防跨境长事务 + `isTableMissingError` 诚实 0）/ `dropTables`（`DROP TABLE IF EXISTS` + `SHOW TABLES LIKE` 复核 dropped））+ `InMemoryDatasetPhysicalStore`（测试替身，复现真实编排语义）+ `assertSafeTableName`（反解一致校验防表名注入）+ `resolveDefinitionTables`（落库表名优先，缺失按规范派生）。**删除语义与顺序**：删版本 = 守卫→清数据→删作业→删版本记录（**保留表结构**）；删数据集 = 守卫→逐版本（清数据+删作业+删版本）→DROP 表→删定义记录；守卫 = 名下存在 RUNNING 作业则拒绝（`VERSION_HAS_RUNNING_JOB` / `DEFINITION_HAS_RUNNING_JOB`）。**后端修改**：`lifecycle.ts` +5 错误码（BUILDER_NOT_REGISTERED/VERSION_HAS_RUNNING_JOB/DEFINITION_HAS_RUNNING_JOB/INVALID_DATASET_CODE/DEFINITION_ALREADY_EXISTS）；`registry.ts` Repo 契约 +4 方法（deleteDefinition/deleteVersion/deleteJobsByVersion/getRunningJobForDefinition）+ Service +`isBuildable`/`requirePlugin`/`requirePhysicalStore`/`deleteVersion`/`deleteDefinition` + `createDefinition` **建表先于落库**（不留「有定义无表」脏定义）+ 显式表名必须等于派生值 + `createJob`/`startJob` 前置 requirePlugin；`db.ts` 实现 4 个 delete 方法；`runner.ts` 移除 `DatasetBuilderFactory`/`io`/`factory`，Deps 改 `{repo, service, plugins}`，按 `definition.datasetCode` 解析插件（**插件解析置于 `markBuilding` 之后**——保持「DRAFT→FAILED 不合法」状态机纪律，执行失败可落 FAILED 可重试）；`query.ts` `toDefinitionListItem(d, buildable)` + `getVersionCounts` try/catch（表不存在返 0 而非 500）；`naming.ts` 改为复用 shared 常量；`index.ts` 导出 plugins/physicalTables。**契约**：`shared/datasetRegistryContracts.ts` +`DATASET_CODE_PATTERN`/`DATASET_CODE_FORBIDDEN_PATTERNS`（前后端唯一同源）+ `datasetCodeSchema`（形态正则 + `.superRefine` 禁止 `_v\d+$`/`_\d+$`/环境名/UUID）+ `DatasetDefinitionListItem.buildable` + 4 个新 schema/结果类型（`createDatasetDefinitionInputSchema`/`deleteDatasetDefinitionInputSchema`（含 `confirmDatasetCode` 强二次确认）/`deleteDatasetVersionInputSchema`/`DatasetPluginListResult`/`DeleteDatasetDefinitionResult`/`DeleteDatasetVersionResult`）。**接口**：`router.ts` +4 端点（`listDatasetPlugins` query / `createDatasetDefinition` admin / `deleteDatasetVersion` admin / `deleteDatasetDefinition` admin）+ 错误码映射（BUILDER_NOT_REGISTERED→PRECONDITION_FAILED；VERSION/DEFINITION_HAS_RUNNING_JOB、DEFINITION_ALREADY_EXISTS→CONFLICT；INVALID_DATASET_CODE→BAD_REQUEST；*_NOT_FOUND→NOT_FOUND）。**前端**：新增 `CreateDatasetDialog`（新建数据集 + 由 `listDatasetPlugins` 权威提示构建能力，导出 `validateDatasetCodeInput`、与后端 zSchema 同源校验）/`DeleteDatasetVersionDialog`（勾选确认）/`DeleteDatasetDialog`（**手工输入 datasetCode** 确认，导出 `isDeleteDatasetConfirmed`）；`VersionListTable` 行级删版本、`DatasetListTable` 未注册插件显示「待实现」徽标、`DatasetList` 页头+空态「新建数据集」、`DatasetDetail` 页头「删除数据集」+ **构建能力门禁**（buildable=false 隐藏构建入口并显示琥珀说明条）、`VersionDetail` 控制条右侧删版本 + 未注册插件时控制条替换为说明条。**新增测试**：`plugins.test.ts` 8 + `physicalTables.test.ts` 9（含表名注入防护）+ `testHelpers.ts` 共享替身 + `datasetManagement.test.ts` 8（前端纯函数）。**验证**：`tsc --noEmit` exit 0；目标套件 **15 文件 190/190 全过**（lifecycle13/registry35/router29/runner9/query13/plugins8/physicalTables9/contracts21/adapter15/…）；`npm run build` PASS（vite 2969 模块）；**真实 TiDB `scripts/verifyDataset003a.mts` 44/44 ✅ exit 0**（8 阶段：未注册插件不建表且 createJob 被拒；第二数据集 3 张独立物理表真实建立；多版本各自真实构建（探针插件自有构建器写自有 event 表，first_limit_pullback 表零写入）；**删版本 purgedRows=4 且 3 张表结构保留、v2 数据未变**；RUNNING 守卫双拒绝；**删数据集 DROP 3 表 + 真实复核表不存在 + 同 code 可重建并再次 DROP 干净**；first_limit_pullback 版本数/行数/表零变化；零残留）；全量 vitest 失败文件与本任务**零交集**（8 个既有环境失败已 grep 确认对 datasetRegistry 零引用）。产出 `docs/step-dataset-003a-report.md`（10 节）。**状态 DATASET-003A = COMPLETE**；DATASET-003B（第二生产数据集插件）不自行启动。§44 无数据快照变更（验证用临时数据集已全部清理；`dataset_definition` 仅剩 `first_limit_pullback` 1 行，ds_* 三表行数不变）。

- **2026-09-10 18:30 — WORK DATASET-003B 构建筛选能力完整化（板块 / 排除ST / 事件相对日 / 前后窗口）+ 🔴涨停判定漏判修复 COMPLETE（真实 TiDB 端到端 47/47）**。用户需求：「构建新版本弹窗的筛选功能中，当前可用的筛选项过少，需要补充和完善筛选能力……只有在完成上述筛选条件配置后，才能进行数据筛选与构建。请明确该筛选功能的整体设计，并说明这些筛选条件及配置信息的保存方案，评估保存在何处更为合适。」**用户拍板四口径**：① 板块口径 = **交易所板块**（主板/创业板/科创板/北交所，与 `classifyBoard` 同源；**明确拒绝申万行业**）；② 事件维度 = **「相对日 × 事件类型」**（两控件组合，多行叠加为 OR；拒绝单枚举）；③ 保存位置 = **新建独立配置表**（**明确拒绝「版本级 JSON 列」**）；④ 生效范围 = **全链路真实生效**。**两层筛选模型**：Universe 层（`boards` / `excludeSt`）+ Signal 层（`events` 相对日×事件类型 OR / `preWindowDays` / `postWindowDays`）+ 执行参数（`outcomeHorizons` / `batchSize`）。**配置三表**：`dataset_build_config`（主表，与 `dataset_version` **1:1 UNIQUE**，标量入列可索引：boards 计数/excludeSt/pre/post/horizons/batchSize）+ `dataset_build_config_event`（多值：relative_day × event_kind）+ `dataset_build_config_board`（多值板块）；理由 = 标量入列**可索引**、多值入子表有**唯一键约束**，**拒绝纯 JSON 一把梭**；migration `drizzle/0029_dataset_build_config.sql` + `scripts/applyDatasetBuildConfig.mjs` 已真实建表（**`ds_*` 三物理表与 Registry 三实体结构不变**）。**语义唯一权威层**：新增 `server/datasetRegistry/filter.ts`（`BUILD_FILTER_DEFAULTS` / `BUILD_FILTER_LIMITS` / `matchesEventKind/Spec/AnyEventSpec` / `eventSpecKey` / `isBoardAllowed` / `isStExcluded` / `maxLookbackDays`）+ 前端纯逻辑层 `client/src/components/datasetRegistry/datasetFilterForm.ts`（`createDefaultFilterForm` / `toggleBoard` / `addEventRow` / `removeEventRow` / `updateEventRow` / **`validateFilterForm` = 构建门禁** / `buildFilterPayload` / `describeFilterForm`）。**锚点语义**：`relativeDay ≤ 0`（0 = t 日、-1 = t-1 日），**契约层 + 纯函数层双层禁止正锚点**（反未来泄漏）；建版本入参收敛为**单一 `filter`**；未完成/非法筛选 → `INVALID_BUILD_FILTER`（**不留半成品版本**）；checkpoint 与筛选口径不匹配 → `CHECKPOINT_INCOMPATIBLE`（**不静默续跑错误数据**）。**三级回退链**：`dataset_build_config` 行 → `version.filterDefinition`（legacy 镜像）→ 权威默认值。**🔴 重大修复（影响既有数据，`detection.isLimitUpClose`）**：原用**未四舍五入**的 `preClose×(1+ratio)` 作涨停阈值，而交易所涨停价**四舍五入到分**；真实数据实测（`_limitprecision_probe.mjs`，2025-01-01..2026-09-04 / 299,946 行）**收盘价恰为涨停价的封板样本 4,325 个中漏判 1,645 个 = 38.03%**；新增权威函数 `server/data/boardRules.ts#exchangeLimitUpPrice(prevClose, ratio) = Math.round(prevClose*(1+ratio)*100)/100`，并统一用于「涨停判定 `isLimitUpClose`」与「事件行事实列 `limitUpPrice`」（同一函数，不各算一套）。**因此 smoke/v1/v2 既有样本数偏低，须用修复后口径重建；重建前不得基于旧数据产出策略结论。** **关键重构**：`limitUpDays: Map<symbol, number[]>`（升序涨停交易日序号 + 二分查找）取代旧 `prevLimitUp + cumulative` 双标量；`tradingDayIndex` 基于完整交易日历、构建范围用 `[windowStartIdx, windowEndIdx]` 表达（**索引基准与构建窗口解耦**）；负锚点下**逐 bar 全量判定**（事件日 T 当天可能不涨停，禁用 `if (!isLimitUp) continue` 早退）；**左边界预热（warm-up）** = 有界回扫 `max(|负锚点相对日|, 1)` 个交易日重建 `limitUpDays`，否则连板被误判首板（T-3 预热深度已专门用例锁定）。**前端**：`VersionDetail.tsx` 版本概览卡新增「构建筛选口径（**建版本时固化，不可后改**）」区块，用 `describeDatasetFilter` + `DATASET_BOARD_LABELS`/`DATASET_EVENT_KIND_LABELS` 展示。**脚本形态变更遗留修复**（我引入的 `pathHorizon → postWindowDays` 曾致 CLI **静默产出 0 条 path**）：`runDataset001Build.mts` CLI 新增 `--boards/--exclude-st/--events/--pre/--post/...`（`--path-horizon` 保留为 `--post` 兼容别名），构建配置改由 `service.resolveBuildConfigForVersion(version.id)` **解析已固化配置**（不再手工拼装）；`verifyDataset0024a/0024b` 的 `createVersion` 补 `filter` 参数，断言改为**配置表回读**（`service.getBuildConfig`）。**新增测试**：`server/datasetRegistry/filter.test.ts`（20 例）+ `client/src/components/datasetRegistry/datasetFilterForm.test.ts`（26 例）+ `builder.test.ts` `filterConfig()` helper 与「筛选口径真实生效」describe（板块/排除ST/T-1 锚点/OR 叠加/preWindowDays 前置行/preWindowDays=0/左边界预热/T-3 预热深度/Universe+Signal 叠加/封板价不漏判 10 组）+ `detection.test.ts` 涨停判定组重写（封板价必判涨 / 低 1 分必判否 / 超涨停价仍判涨）。**验证**：`npx tsc --noEmit` exit 0；目标套件 **17 文件 / 252 tests 全过**（基线 193 → 252）；`npm run build` PASS。**真实 TiDB 端到端 `scripts/verifyDataset003b.mts`（10 阶段 47 项检查全部通过，47/47 失败 0，生产同源装配）**：① 构建门禁（events 空 / postWindowDays 越界 / **正锚点未来泄漏** / 未知板块 四类全拒 + 拒绝后不留半成品 `before=3 after=3`）；② 基准版本真实 READY（events=740 / rows=17020）+ 配置回读逐字段一致 + 版本详情带 `buildConfig` 可渲染；③ **板块筛选真实生效**（仅主板 682 < 全板块 740 且严格子集）；④ **排除 ST 真实生效**（对照组含 ST 样本 71；排除版 669 事件逐条按**生产 PIT 口径**回查**违规 0**）；⑤ **T-1 日锚点真实生效**（790 事件，抽查 60 笔「前一交易日确实涨停」**违规 0**）；⑥ **前置窗口真实物化**（`preWindowDays=5`：负相对日 path 行 3700、`close` 非空 3605 行 = 真实 OHLC 非占位，`distinct=[-5..-1]` 且夹取在日历左边界内诚实不臆造）；⑦ 删除级联清配置（`purgedRows=8880 jobsDeleted=1 configsDeleted=1`）+ 临时数据集 DROP 3 表；⑧ **零残留**；⑨ 终态非原子性实测 lag = `[0,0,0,840,833]` ms。**数据快照**：验证用 5 个临时版本全部清除 → `dataset_definition` 仍 1 行、`dataset_version` 仍 3 行（smoke/v1/v2）、`dataset_build_config` 回落 0 行、三张 `ds_*` 表行数未变。**并行发现（未修复，已上报）**：`runner.ts` 收尾 `completeJob → markReady` 为**两次独立写库**，窗口内可观测 `job=COMPLETED` 而 `version=BUILDING` 且计数 0（实测非零窗口 840ms / 833ms）；若进程在两次之间崩溃版本将**永久停留 BUILDING**（`COMPLETED` 不可 retry），建议合并为单事务。**并行排查（结论：非重复写入）**：针对用户「path 跟 outcome 的数据一直重复」，真实 DB 三层取证（`_dupcheck_probe.mjs`）——L1 表内重复 **0**（三表按唯一键分组 `HAVING COUNT(*)>1` 均 0 组）；L2 跨版本同源属**版本隔离的正确行为**（每版本各存一份，最多 6 版本）；L3 `path_rows = 事件数 × 相对日数` 严格成立；观感重复来自「临时验证版本与 v1/v2 窗口重叠」+「v1 窗口是 v2 子集」。**另**：用户问「已完成构建为何后台还在跑」——目标版本 job COMPLETED ≠ 验证脚本整体结束（串行 5 个版本 + 逐事件回查 + 级联删除 + 零残留）。**PIT 取证附带结论**：`_t1anchor_probe.mjs` 确认 000615.SZ / 000669.SZ / 002309.SZ 在 2023-12-29 均为 ST（收盘价恰等 **5%** 涨停价），此前验证脚本按代码前缀取 10% 误判为「构建器 bug」，实为**脚本错误**（已改用生产函数 `limitUpRatio + isLimitUpClose` + `DbDatasetBuildIO.resolveSt`）。**教训**：验证脚本必须加 `withRetry`（跨境 TiDB 只读瞬时 ECONNRESET）+ `emergencyCleanup`（`unhandledRejection`/`uncaughtException` 钩子）+ `safeDeleteVersion`（先 `cancelJob` 再删，否则撞 `VERSION_HAS_RUNNING_JOB`）；临时 datasetCode 勿以数字结尾（`INVALID_DATASET_CODE`）。产出 `docs/step-dataset-003b-report.md`（10 节）。**状态 DATASET-003B = COMPLETE**；不自行启动下一任务。

- **2026-09-10 18:40 — WORK DATABASE-DESIGN-001 数据库设计文档 + 事件窗口四表划分方案（文档交付，改造待评审）**。用户需求两则：①「感觉还是缺两张表，一张表用来存储 t 日及 t 日之前的数据，一张表用来存储 t 日之后的数据，不应该只有 path 跟 outcome 两张表」；②「需要你整一个数据库设计的 md 文档，用来解释现在数据库所有的表，及表中的字段」。**实查基线**（真实 TiDB 只读探针 `scripts/_schema_probe.mts` → `_schema_probe_out.json`，直连 `information_schema`）：**全库 39 张表 / 422 字段 / 185 索引项**。**🔴 重大修正**：跨表**确实存在 t 日重复**——`ds_*_path` 的 `relativeDay=0` 行与 `ds_*_event` 的 t 日 OHLC 是同一份数据，行数**完全 1:1**（smoke 151=151 / v1 516=516 / v2 10,240=10,240，合计 10,907）；§47 18:30 条目的「非重复写入」结论**仅覆盖表内重复，未覆盖跨表 t 日重复**，本次予以更正。同时实测三版本 `negRows` 全为 **0**，即 `preWindowDays` 的负相对日尚未落库（仅在临时验证版本出现）。**用户拍板三口径**：① 表划分 = **严格互补零重复**（event 只存事件身份、**去掉 8 个行情列** OHLC/prevClose/volume/amount/turnover；行情行只存在于 prefix(≤0) 与 path(≥1)）；② 命名 = **`prefix` / `path`**（保留 path 表名，只收紧 `relativeDay` 语义为 ≥1；拒绝 `pre_event/post_event` 改名）；③ 本轮范围 = **只出设计文档，改造待评审**（不动代码）。**交付物 `docs/DATABASE_DESIGN.md`（811 行 / 6 节 + 2 附录）**：7 层分层总览（L1 外部数据域 10 表 / L2 回填运维 5 / L3 数据集注册 6 / L4 数据集物理表 3 / L5 研究链路 8 / L6 应用层 4 / L7 框架 1）+ 39 张表逐字段说明（类型 / 键 / 默认值 / 中文说明）+ 横向设计约定（命名 / PIT / 状态枚举 / 数值类型选择 / 身份与复权）+ **目标设计「事件窗口四表划分」** + 迁移影响分析 + 已知问题清单。**四表目标设计**：`event`（事件身份，约 16 列）/ `prefix`（**新增**，`relativeDay ∈ [−preWindowDays, 0]`，约 15 列，**不含任何 `*FromEventClose`/`isBreakout` 列**）/ `path`（`relativeDay ∈ [1, +postWindowDays]`，结构不变）/ `outcome`（不变）。**核心论证**：prefix 与 path 的分界落在 **t 日**，而这个分界恰好是「可用于特征（后视，PIT 安全）」与「仅可用于标签（前视）」的 **PIT 边界**——拆表后「误用未来信息」从"需要人工判断"变为"表选错就查不到"，这是本方案最大价值。定义 **8 条不变量 I1~I8**（I5 `event` 行数 = `prefix` 中 `relativeDay=0` 行数；I8 = `prefix` 表**不含** `*FromEventClose`/`isBreakout` 列，属**结构级 PIT 防线**）。**改造必踩坑已标注**：`EventReference`（`eventClose`/`eventHigh`/`eventVolume`）当前取自 `event` 表行（`builder.ts#buildEventPathsAndOutcomes`），event 删行情列后**必须改道从 `prefix(relativeDay=0)` 取**，否则 path/outcome 全部衍生列算空。**迁移面**：`DatasetRole` 增 `prefix`；`dataset_definition` 增 `prefixTableName`；migration `0030`；`ds_*_outcome` 完全不受影响；物理表操作层按插件 `physicalTables` 声明驱动，**天然覆盖新表、无需硬编码**。建议与 P1 涨停口径修复**一次性重建**，不做 `ALTER` 渐进迁移。**§44 无数据快照变更**（本文档为纯只读实查 + 文档产出，未改动任何数据）。**状态 DATABASE-DESIGN-001 = 文档交付完成，改造待用户评审后启动**。

- **2026-09-10 19:00 — WORK DATABASE-DESIGN-002 血缘实证 + 列级冗余发现 + 设计定稿为五表三层血缘（文档定稿，代码零改动）**。用户追问：「path 与 outcome 是不是存在强相关？path 表中的数据并不是原生的日线交易数据，是不是需要再加一张表来存储 t 日之后的原始交易数据？」**三项实证（只读探针，非推理）**：**① 血缘 = 函数依赖**——`path.ts#buildOutcomeRow` 中 `window = bars.filter(b => b.relativeDay >= 1 && b.relativeDay <= horizon)`，即 `outcome(H) = f(path.filter(1 ≤ relativeDay ≤ H))`；实测 v1（id=30001）逐条比对 **1,509 条 outcome 行**：精确相等（<1e-9）**1,506** + 双方同为 NULL **3** = **100% 可重算**，**最大绝对偏差 = 0**；3 条 NULL 样本（`300799.SZ@2024-01-23` H=5、`600647.SH@2024-01-11` H=5/H=10）窗口内无行情，双方一致属诚实不伪造；方向性明确——outcome 可由 path 重算，反之不可（极值聚合有损）。**② `path` 非原生数据确认**——24 列 = 6 身份 + **7 原始** + **10 衍生** + 1 时间戳，10 个衍生列全部是 `ref=(eventClose,eventHigh,eventVolume)` 的函数（前视）。**③ 🔴 `path` 表列级冗余（新发现，"数据重复感"的真实来源）**——`_coldup_probe.mts` 实测：`returnFromEventClose` ≡ `closeFromEventClose` **213,536/213,536 行完全相同**（源码同一表达式 `ratioTo(bar.close, ref.eventClose)`）、`lowFromEventClose` ≡ `pullbackFromEventClose` **213,536/213,536 行完全相同**、`path.turnover` **213,536 行全 NULL（死列）**、`breakoutPrice`/`daysToBreakout` 为每行重复常数 → **名义 24 列实际只有 19 个不同的量**。另实测 `path(relativeDay=0)` 与 `event` t 日 OHLC **10,907/10,907 行完全同价**（跨表 t 日重复铁证）。**🔴 新发现 P7（上游缺陷）**：`liquidity_daily` 9,015,158 行中 `totalMarketCap` / `circulationMarketCap` **全 NULL**（而 `turnoverRate` 99.14% 正常）→ 下游 `ds_*_event.marketCap`/`floatMarketCap` 全 10,907 行 NULL；**任何依赖市值/流通盘的特征与筛选目前全部不可用**；`event.industryCode` 全 NULL 则是 P4（G 域 `effectiveFrom` 单点 2026-08-31 无法覆盖历史交易日）的下游后果，非独立缺陷。**用户三项拍板**：**① 采纳五表方案**（引入「原始事实 / 派生指标」第二正交维度）；**② 命名 `prefix` / `post` / `path`**（保留 path 名使下游改动最小）；**③ 清理范围 = 仅删除 2 对完全重复的列**（删 `returnFromEventClose`、删 `pullbackFromEventClose`）。**明确保留未清理**（已在文档显式记录以免遗忘）：`turnover` 死列随原始列移入 `prefix`/`post`、`breakoutPrice`/`daysToBreakout` 仍为每行重复常数（更合理位置是 `event`）、**P7 上游市值回填链路未排查**。**定稿设计（五表三层血缘）**：`event`(身份，16 列) + `prefix`(L-事实 原始 ≤0，14 列) + **`post`(L-事实 原始 ≥1，13 列，新增)** → `path`(L-衍生 ≥1，15 列) → `outcome`(L-聚合，10 列，取数改从 `post`)；`prefix`/`post` **同构**（仅 relativeDay 区间不同）可用同一 DDL 生成器，代码零重复。**两条核心论证**：① `prefix`/`post` 的分界落在 t 日 = 「可用于特征（PIT 安全）」与「仅可用于标签」的边界；② `prefix`/`post` 与 `path` 的分界落在「原始 vs 衍生」= 前视指标物理隔离，血缘可证、衍生口径变更只需重算 `path`+`outcome` 而不动昂贵的原始事实层。**候选方案对比（§4.7）**：不拆表只清冗余 ❌ / 仅切 t 日前后四表 ❌ / **两维度交叉五表 ✅ 已定稿**。**文档定稿**：`docs/DATABASE_DESIGN.md` 923 → **987 行**（§4 改题「事件窗口五表分层（已定稿，尚未实施）」；§4.1 补问题 ④ 列级冗余 / ⑤ outcome 与 path 平级存放；§4.3 重写为 4.3.1~4.3.5；§4.4 不变量扩到 **I1~I11**；§4.7 改为设计取舍记录；§5 新增 **§5.4 建议实施顺序 S1~S5**；附录 B 记录 39 → 41）。**实施顺序（待授权）**：S1 `naming.ts` 增 `prefix`/`post` role + `plugins.ts` 增两表 DDL + `dataset_definition` 增两列（migration `0030`） → S2 `types.ts`/`path.ts` 拆分（`buildRawBars`→`post`、`buildDerivedRows`→`path`）+ `builder.ts` **`EventReference` 改道**（否则衍生列全空） → S3 `db.ts`/`query.ts`/`router.ts`/契约/前端适配 → **S4 一次性重建 smoke/v1/v2（同时收敛 P1 涨停口径）+ 不变量 I1~I11 断言** → S5 可选宽视图 `ds_{code}_path_wide` + P7 排查。**§44 无数据快照变更**（本次全部为只读探针 + 文档产出，**代码与数据库结构均未改动**）。**状态 DATABASE-DESIGN-002 = 文档定稿，等待授权启动 S1**。

### 2026-09-10 19:25 — WORK DATABASE-DESIGN-005（问题存在性裁定 + 最终设计定稿 + 附录 D 完整 DDL）

- 用户问：「所以上面的问题到底存不存在，给出最终设计」→ 对前几轮反复讨论的议题做**一次性裁定**并收敛设计。
- 新增只读探针 `scripts/_d0_probe.mts`（D0 完整性 = C3 决策依据）实测：三持久版本 `relativeDay=0` 行的 `close`/`open`/`high`/`low`/`volume`/`amount` **100% 非 NULL**（516 / 151 / 10,240 全对）；**孤儿事件（有 event 无 `rd=0` 行）= 0**；⚠️ **`MIN(relativeDay)=0` 且 `neg_rows=0`**。
- 🔴 **修正 `docs/DATABASE_DESIGN.md` §4.1 问题 ② 表述**：负相对日**从未落库**（三持久版本走 legacy 默认 `preWindowDays=0`，`dataset_build_config` 无行）→ 属**设计缺陷**，**不是**现存数据污染。DATASET-003B 临时验证版本曾实际产出 3,605 行，**一旦以非零 `preWindowDays` 建版本即触发**，故仍须在五表改造中解决。
- **C3 定性翻转**：由「会减行数、待确认」→ 「**零代价防御，已采纳**」（无孤儿事件 → 采纳不减少任何现存行）。**至此无遗留待决策项**。
- 新增 **§4.0 问题存在性裁定**：8 项议题三分类（存在于数据 ①④ / 存在于设计 ③⑤ / 设计缺陷未触发 ② / 已证伪 ⑦⑧）+ 编译期可见 ⑥，逐项附实测依据。
- 新增 **附录 D「目标结构完整 DDL（S1 可直接执行）」**：D.1 `event` 18 列 / D.2 `prefix` 13 列 / D.3 `post` 13 列（与 `prefix` 严格同构）/ D.4 `path` 15 列 / D.5 `outcome` 10 列 / D.6 migration `0030`（`dataset_definition` 增 `prefixTableName` + `postTableName`）/ D.7 列数对照速查（合计 **58 → 69**）。DDL 风格与 `plugins.ts` 生成器一致，显式标注**必须自包含**（禁 `CREATE TABLE ... LIKE 模板表`）。
- `docs/DATABASE_DESIGN.md` 1083 → **1244 行**；§4 标题改为「✅ 已定稿，无遗留待决策项，待授权实施」；口径声明 / 附录 B / 附录 C 同步。
- 状态：**设计与文档定稿**；**代码与数据库结构仍零改动**；待 S1 授权（或 S4 一次性重建授权）。
- 教训：「**设计缺陷**」与「**数据事实**」必须分开表述 —— 本轮纠正我上一轮把 path 负相对日的设计风险说成现存污染的过度断言。三分类裁定表应作为后续文档的标准写法。

### 2026-09-10 19:30 — WORK DATABASE-DESIGN-006（文档拆分：现状结构 / 改造方案 分为两个独立文件）

- 用户要求：「把数据库设计文档，跟后续的说明拆开，不要混在一起」→ 此前 1244 行单文件把「现状事实」与「待实施方案」互相穿插，不利维护与评审。
- **拆分结果**（按标题锚点脚本切分 + 节号重排 + 交叉引用改写，**非手工转录**）：
  - **`docs/DATABASE_DESIGN.md`（663 行）= 现状结构说明书**，唯一职责「数据库现在是什么」：§1 分层总览 / §2 逐表字段说明 / §3 横向设计约定 / 附录 A 生成与复核方式 / 附录 B 证据脚本。**不含任何改造方案**。
  - **`docs/DATABASE_REDESIGN.md`（594 行，新建）= 改造方案书**，唯一职责「要改成什么、为什么、怎么改」：§1 现状问题与存在性裁定（原 §4.0+§4.1）/ §2 目标设计五表三层血缘（原 §4.2~4.7）/ §3 迁移影响分析含 `EventReference` 改道（原 §5）/ §4 已知问题清单 P1~P8（原 §6）/ 附录 A 完整 DDL 子节 A.1~A.7（原附录 D）/ 附录 B 表数量变更记录。
- **节号重排映射**：§4.0→§1.1、§4.1→§1.2、§4.N→§2.(N-1)（N≥2）、§4.3.x→§2.2.x、§5.x→§3.x、§6→§4、附录 D→附录 A。用正则 `§([456])(?!\d)(\.\d+(?:\.\d+)?)?` 统一重写；**负向断言 `(?!\d)` 防止误伤外部引用 `ROADMAP §44.1`**（已验证未被改写）。
- **双向交叉引用**：DESIGN 内 8 处缺陷标注统一改为「见《重构方案》§4 P#」；两文件头部互相声明定位与状态（DESIGN 声明只写现状、REDESIGN 声明只写方案）；DESIGN §1 补「L4 物理表数量 3 → 5」提示。
- 顺带修正：DESIGN 附录重编号（原 A/C → A 生成方式 / B 证据脚本）；**补回此前工具报成功但实际未落盘的两行探针**（`_turnover_probe.mts` / `_d0_probe.mts`）；去除拼接产生的重复分隔线 3 处。
- 🔴 **教训（流程）**：**同一文件在同一批次并发提交多个 Edit 会丢失改动** —— 本轮发现此前两次编辑（「附录 C 补两行探针」「§5.4 待确认改写为已定」）报成功但未落盘。此后凡多编辑同一文件，**必须逐条提交并回读复核**。
- **§44 无数据快照变更**（纯文档操作，**代码与数据库结构零改动**）。**状态 DATABASE-DESIGN-006 = 文档结构交付完成，改造方案仍待授权实施（S1）**。

### 2026-09-10 20:15 — WORK DATABASE-DESIGN-007（事件窗口五表分层 **S1~S4 全量落地**：代码 + 就地迁移 + 不变量 I1~I11 断言）

- 用户指令：「按照 `docs/DATABASE_REDESIGN.md` 这个文件重新修改数据集构建功能。之前的代码能删就删掉，但也要跟之前的功能不要有太大差距。页面上一些说明文字也删掉」。
- **S1 命名 / DDL / Registry 列**：`naming.ts` `DATASET_ROLES` 由 `event/path/outcome/feature` 扩为 **`event/prefix/post/path/outcome/feature`**（顺序即天然层级）；`plugins.ts` `eventCreateSql` **删 6 个日线行情列**（open/high/low/close/volume/amount → 18 列）、新增 `rawBarCreateSql(tableName, keyPrefix)` 生成器（`prefixCreateSql`/`postCreateSql` 复用，**代码零重复**，不变量 I10）、`pathCreateSql` **删 9 列**（6 原始 + `turnover` 死列 + 2 对重复列 → 15 列）；`types.ts` / `drizzle/schema.ts` 同步（新增 `firstLimitPullbackPrefixes` / `firstLimitPullbackPosts`）；migration `drizzle/0030_dataset_window_layering.sql`（`dataset_definition` 增 `prefixTableName` / `postTableName` + 回填）。
- **S2 纯函数拆分 + `EventReference` 改道（§3.3）**：`path.ts` 重写——`EventReference` 三字段放宽 `number | null`（**C2：禁 `?? 0` 兜底**）；新增 `eventReferenceFrom(bars)` **只从入参 `relativeBars` 的 rd=0 行取参考价**（**C1：单源，与 prefix 行同源，禁从 `DailyBar` 另取一套**，零 DB 往返）；新增 `buildRawBar` / `buildRawBars` / `partitionRawBars`（rd ≤ 0 → prefix，rd ≥ 1 → post）；`buildDerivedRows` 只产 rd ≥ 1；**C3：D0 无行情则跳过事件**（实测零代价——三版本 rd=0 行 OHLCV/量额 100% 非 NULL、孤儿事件 0）。
- **S3 构建编排 / IO / 查询 / 路由 / 契约 / 前端**：`builder.ts` 新增 `buildEventWindows()` 一次产出 `{prefix, post, paths, outcomes}`（ref 为 null → 全空 = C3）、Phase 2 更名 `buildWindowsAndOutcomes` 并落 `pendingPrefixes`/`pendingPosts`、`buildRelativeBarsFull` **去掉 `turnover: null` 死字段**；`db.ts` 新增 `insertPrefixes` / `insertPosts`（共用私有 `insertRawBars(table, rows)`）；`query.ts` 新增 `DatasetRawBarRole` / `listRawBarsPage`（参数化表名）、`DatasetVersionCounts` 增 `prefixCount`/`postCount` 且 `rowCount` = **五表和**；`router.ts` 新增 `listPrefix` / `listPost` 端点；`shared/datasetRegistryContracts.ts` 新增 `rawBarPageInputSchema` / `DatasetRawBarItem`，`DatasetEventItem` / `DatasetPathItem` 同步删列；前端 `DatasetPreviewTable.tsx` 重写为**五表 Tab**（prefix/post 共用原始行情渲染，path 只显示衍生列）、`VersionDetail.tsx` 增 Prefix/Post 两个 Tab。
- **S4-a 数据库就地迁移（`scripts/applyDatasetWindowLayering.mts`，新增）**：① 建 `prefix` / `post`（DDL 取自插件声明，**列清单唯一权威 = `plugins.ts`，本脚本解析其 DDL 文本，不另写第二份字段清单**）；② `path` rd ≤ 0 的 **10,907** 行 → `prefix`（t 日唯一归属）；③ `path` rd ≥ 1 的 **202,629** 行 → `post`；④ 删 `path` 中 rd ≤ 0 行（**PIT 边界收紧为 ≥ 1**）；⑤ `path` 摘 9 列 / `event` 摘 6 列；⑥ 回填定义表名 + 刷新 `totalRows`。**幂等**，支持 `--dry-run`（只输出计划）/ `--check`（只校验列集合）。**实测执行 37s**：
  - `event=10,907` / `prefix=10,907` / `post=202,629` / `path=202,629` / `outcome=32,721`；`version.totalRows` → smoke **1,801** / v1 **14,456** / v2 **443,536**。
  - **零数据丢失**：被摘列全部为重复列（`returnFromEventClose` ≡ `closeFromEventClose`、`pullbackFromEventClose` ≡ `lowFromEventClose`，各 213,536/213,536 行完全相同）、死列（`path.turnover` 全 NULL）、或已由 `prefix(rd=0)` 承载的原始 OHLC（实测 `EVENT vs PATH(rd=0)` 同值 **10,907 行**）。**未做 DROP TABLE / 未重跑构建**。
- **S4-b 不变量断言（`scripts/verifyDatasetWindowLayering.mts`，新增）**：`docs/DATABASE_REDESIGN.md §2.3` 的 **I1~I11 逐条可执行化**（结构层 + 数据层 + I11 抽样逐条重算）。**真实 TiDB 结果：31 项检查通过 31 / 失败 0**，覆盖三版本 smoke(1801) / v1(14456) / v2(443536)：I1 键集合两两不相交、I2 每事件恰好一行 prefix.rd=0、I3 event 无日线列（18 列）、I4 区间（prefix=[0,0] / post=path=[1,20]）、I5 `events == prefix.rd=0`、I6 `outcome == events × |horizons|`、I7 五表业务键唯一、I8 prefix 无衍生列（13 列）、I9 post 只含身份+原始行情（13 列）、I10s prefix/post 严格同构 + I10 post/path 键集合完全相等、**I11a path 可由 prefix(D0)+post 100% 重算**（v2 抽样 200 事件 / 3,943 行 / 不一致 0）、**I11b outcome 可由 path 100% 重算**（不一致 0）。
- **行数口径统一（修正口径不一致缺陷）**：`runner.ts#markReady` 原取 `prefixes + posts + paths + outcomes`（**漏 event**），与 `DatasetVersionCounts.rowCount`（五表和）**永久对不上** → 统一为五表和；`scripts/runDataset001Build.mts` 同步（并补齐 prefixes/posts 输出）；`runner.test.ts` 断言 123 → **126**。
- **脚本工具链同步**：`scripts/verifyDataset001.mjs` 重写为五表校验（`prefixDay0` / `I5` / `I10` / `postRange` / 涨停价 sanity 改从 `prefix(rd=0).close` 取、结构级 PIT 防线断言）；`scripts/verifyDataset003b.mts` 阶段 2/6/7 改造（新增 `PREFIX_TABLE`/`POST_TABLE`，阶段 6 断言改为「prefix 含负相对日 + prefix 含唯一 rd=0 + **path 无 rd ≤ 0 行** + prefix 无衍生列」，阶段 7 五表清零）；`scripts/applyDatasetRegistry.mjs` 注释声明**物理表 DDL 权威在 `plugins.ts`**、唯一约束改按**列序列**断言（不依赖索引名，兼容 0028 legacy 名与插件 DDL 名）、物理表缺失只告警不再 fail（实测 8 表全在、8 个唯一约束全中）。
- **「能删就删」执行**：删 `buildPathRow`/`buildPathRows` 旧名、`RelativeBar.turnover`、`buildRelativeBarsFull` 的 `turnover: null` 硬编码、`DatasetDefinition` 旧构造路径、前端全部无用 import；页面说明文字按指令清理（`DATASET-003A` 徽标、各 `CardDescription`、构建门禁提示块、空态 description、keyset 分页说明等）。
- **验证**：`npx tsc --noEmit` **exit 0**；目标套件 **18 文件 / 268 tests 全过**；全量 vitest 失败文件仍为**8 个既有环境依赖失败**（Tushare token/网络、DB 依赖、认证快照），与本次改造**零交集**（本改造前即存在）。
- **§44.1 覆盖式更新**：Dataset 段落改为五表快照表（逐表列数 + 全库行数 + 版本内行数）+ `totalRows` 口径说明 + 就地迁移说明；DATASET-003B 备注 ⑥ 加注「该描述属五表前 3 表结构」。
- **遗留（未做，明确记录）**：🔴 DATASET-003B 的 **P1 涨停口径修复后重建 smoke/v1/v2 仍未执行**——故 `RESEARCH_READY=TRUE` 的既有结论保持，但**基于当前 ds_* 数据的策略结论仍不得产出**；`runner.ts` `completeJob → markReady` **两次写库非原子**（实测 lag 0~840ms）仍未修复；`path.turnover` 死列已随迁移消失，但 `event.turnover` 上游 `liquidity_daily.turnoverRate` 之外仍有 P7（市值列全 NULL）未排查。

### 2026-09-10 22:56 — WORK RESEARCH-001（Research 数据库与领域对象：**10 张表落库 + Domain + Repository**，Phase A~F 全量）

- **任务定位**：Dataset 构建可完成后正式进入 Research 模块。RESEARCH-001 只做「Research 的数据库与领域模型」——**不实现** Engine / 统计计算 / 前端 / 因子挖掘 / 参数搜索 / Backtest。完成标志 = 持久化与领域模型稳定到可在其上开发 Research Engine 而无需重构核心数据结构。
- **Phase A 审计（`docs/research/RESEARCH-001-AUDIT.md`）**：读代码 + **实查真实 TiDB**（`information_schema`）。关键发现：① 既有 `research_experiments` / `research_runs` / `research_datasets`（**复数**）是 **STEP 6.x 遗留链路**（字符串 `experimentId` 业务键 + `strategyId` 驱动 + 单一 `snapshotJson`），与指令要求的 `research_experiment`（`datasetVersionId` bigint 驱动）**非同一领域对象** → **用户拍板：严格按指令命名，遗留三表零改动**，两套并存、互不引用，靠 schema 块注释 + 审计报告 §4 对照表消歧。② `dataset_version.id` 是 **bigint** → Research 全部外键列 bigint。③ `strategies.strategyId` 是 varchar(64) → Candidate 的 `strategyDefinitionId` 用 varchar(64)。④ 项目**零 DB FK**（soft reference）。⑤ 新表约定：列 camelCase / 表 snake_case 单数 / JSON 一律 longtext / 状态列 varchar + 应用层联合类型（**不用 mysqlEnum**）。⑥ ⚠️ `drizzle/meta/_journal.json` **只到 idx 23、snapshot 只到 0015**，而 `drizzle/*.sql` 已到 0030 —— 0024~0030 全部是「手工 SQL + 幂等 apply 脚本」落库，**journal 已停维护** → **禁止 `drizzle-kit generate`**（会拿 schema.ts diff 0015 snapshot 产出垃圾），采用项目**实际在用**的 apply 脚本流程，**且不手工补写 journal**（属指令禁止的伪造）。
- **Phase B 设计（`docs/research/RESEARCH-001-SCHEMA.md`）**：10 张表字段 / 类型 / nullable / 索引 / 唯一 / JSON 边界 / 生命周期 / 引用方向 + ER 图 + §24 反模式逐条自查。**相对指令的 10 处调整全部记录**（id 用 bigint 对齐 dataset_version；condition 新增 `sortOrder` 保组内确定性、新增 `groupLogicalOperator` 支持条件组；2 个唯一约束 `uq_research_run_experiment_run_no` / `uq_research_analysis_metric_analysis_code`；`confidence` 注释「主观置信度，非 p-value」等）。
- **Phase C 落库**：`drizzle/schema.ts` 追加 10 表定义（块注释显式写明「与遗留 `research_experiments` 的区别」）；`drizzle/0031_research_core.sql`（38 条语句，纯新增 `CREATE TABLE IF NOT EXISTS`）；`scripts/applyResearchCore.mjs`（幂等 apply + **95 项 information_schema 断言**）。**实测真实 TiDB：`PASS — 检查 95 项，失败 0 项`**；**10 表 / 103 列 / 30 索引项（28 idx + 2 unique）+ 10 PK**；**二次运行幂等**（`38/38` → `10/38` + 幂等跳过 28）；反模式扫描「Research 侧 Dataset 复制表 = 0 张」。
- **Phase D Domain（`server/researchCore/`）**：新模块目录**纯语义 camelCase、无数字后缀**（§49.1）。`types.ts`（**15 类枚举集中管理** —— `const 数组 as const` + 派生类型，同时给运行时取值与编译期类型；10 个领域对象）/ `config.ts`（Experiment / Run / Analysis 配置 + `ResearchInputSnapshot` 执行快照 + 默认值解析纯函数）/ `conditions.ts`（条件组装配 / 校验 / 渲染，**不是**不可解析字符串）/ `results.ts`（指标码登记表 + 单值 / 分组 / 序列构造 + 结构化边界校验）/ `candidates.ts`（规则集 + 候选状态机 + 转正一致性）/ `serialization.ts`（JSON 编解码，**解析失败抛错不静默**）。⚠️ **本模块不并入 `server/research/index.ts` barrel** —— 那里已导出 STEP 6.x 的 `ResearchExperiment` / `ResearchRun`（**同名不同物**），合并会冲突。
- **Phase E Repository**：`repository/contract.ts`（10 个单实体接口 + `ResearchRelationshipQueries` 关系查询 + `ResearchRepositories` 聚合）/ `errors.ts`（**机器可读错误码**，零 FK 下引用合法性必须应用层保证）/ `db.ts`（真实 DB，写入前**实查父引用存在性**，含 `dataset_version`）/ `inMemory.ts`（测试替身，**不变量与错误码与 db.ts 严格对齐**）。
- **Phase F 测试与验证**：**单元 + 契约测试 82 tests 全过**（`types` 13 / `conditions` 15 / `results` 11 / `candidates` 11 / `repository/inMemory` 32），覆盖指令 §26 F 的 **10 类 CRUD** + §18 关系查询 + §21 引用完整性 + §25 完整链路；**真实 DB 端到端验证 `npx tsx scripts/verifyResearchCore.mts` → `PASS — 检查 45 项，失败 0 项`**（跑的是 `createDbResearchRepositories()` 本体；含「裸 SQL 重复插入被 DB 唯一约束拒绝」「结构化列 metricCode/metricValue/sampleCount 可 SQL 直查」「分组行 dimensionJson 含 quantile」等硬证据；逆序自动清理，零残留）。
- **验证**：`npx tsc --noEmit` **exit 0**；全量 vitest **178 文件 / 2720 tests 通过**，8 个失败文件（image.uploadAndRecognize / limitUp / limitUp.watch / marketData / researchRunRouter / tushare.secret / tushareTradingCalendar / dataHealth）**全部为既有环境依赖失败**（Tushare token / 网络 / DB / 认证快照），与本次改动**零交集**（改动为纯新增模块 + 纯新增表）。
- **架构边界自证**：Research 不复制 Dataset（无行情表 / 无 event·prefix·post·path·outcome 副本）；不直接改 Dataset Version（只读 `datasetVersionId`）；不执行 Backtest；Candidate 与正式 Strategy 分离（`strategyDefinitionId = NULL` 合法，只软引用不写 `strategies`）；Experiment ≠ Run；Analysis ≠ Result；Hypothesis ≠ Conclusion —— 全部有测试或 DB 断言背书。
- **交付物**：`docs/research/RESEARCH-001-AUDIT.md`、`docs/research/RESEARCH-001-SCHEMA.md`、`docs/research/RESEARCH-001-report.md`（17 节最终报告）、`drizzle/0031_research_core.sql`、`scripts/applyResearchCore.mjs`、`scripts/verifyResearchCore.mts`、`server/researchCore/**`（6 个领域文件 + 4 个 repository 文件 + 5 个测试文件）。
- **遗留 / 已知问题（明确记录）**：① `drizzle/meta/_journal.json` 与 `*_snapshot.json` **自 0024 起停止维护**（本次**未**补写，按指令不伪造），后续若要用 `drizzle-kit` 需先重建 baseline；② 遗留 `research_experiments` 与新增 `research_experiment` **仅差一个 s**，已用 schema 块注释 + 两份文档对照表消歧，**未来若清理遗留链路应优先重命名遗留表**；③ `server/researchCore` 暂未接 tRPC 路由与前端（属后续任务）；④ 未建 `research_result.createdAt` / `research_artifact.uri` 索引（无对应查询模式，避免机械建索引）。

### 2026-09-11 18:58 — WORK DATASET-PERF-001 数据集构建性能专项（连接池生效 + SQL 下推粗筛 + 定向取数 + 分片细化 + 有界并发；**零口径变更 + 端到端逐字节等价**）

- **用户需求**：「数据集构建的功能差不多可以了，但是构建速度还是很慢，分片策略并不是很好，想办法从技术或者逻辑层面优化一下，不如使用数据库连接池，多线程，分片策略更加细致」。三个候选方向（连接池 / 多线程 / 更细分片）全部采纳并落地，且**要求「从技术或逻辑层面」优化**（允许改架构）。
- **根因实测（真实 TiDB，临时探针 `_dsperf_probe.mts`/`_dsperf_probe2.mts` 跑完即删）**：RTT ≈ **208ms/次** → 构建是**延迟受限**，不是算力受限。三条实锤：① **连接池形同虚设** —— 全程 `await` 串行，`connectionLimit=10` 实际只用 1 条连接（并发标定实测 1/2/4/8 → **7,704 / 8,425 / 12,733 / 17,862 行/s**，证明池有价值但旧代码从未用上）；② **取数粒度过粗** —— Phase 1 `fetchBarsForDay` 逐日拉全市场（单日 5,349 行/796ms）、Phase 2 `fetchSymbolBars` 逐事件拉全市场（61 天全市场 **219,455 行/16,925ms**），把 8,893,077 行的 `stock_daily_prices` 大量搬过跨境网络；③ **分片维度用错** —— 按「天」切，而真正的富集/落库单元是「事件集合」。附带实测：`insert` 1,000/2,000/5,000 行 → 347/817/1,054ms（占位符上限约束）；月度分片并发 1/4/12 → 13,146/8,500/**3,903ms**；`liquidity_daily` 9,015,158 行（有 `uq_liquidity_daily_security_date`）；`industry_assignments` 5,212 行/230ms。
- **新增 `server/datasetRegistry/concurrency.ts`（零依赖有界并发原语 + 分片常量唯一来源）**：`defaultConcurrency()`（`DB_POOL_SIZE` 或 8、上限 32）、`chunkArray`、`mapWithConcurrency`（**结果保序**、快速失败且不产生未处理 rejection）、`forEachWithConcurrency`；常量 `SYMBOL_BATCH_SIZE=400` / `MAX_ROWS_PER_STATEMENT=2000`（占位符 65535 上限保护）/ `PATH_CHUNK_DAYS=30` / `EVENT_CHUNK_DAYS=20` / `CANDIDATE_RANGE_MAX_MONTHS=1` / `INSERT_CONCURRENCY=2`。**明确不用 `worker_threads`**：`limitUpDays` 连板状态必须**单线程串行推进**，Node 无共享内存，故「多线程」的正确等价物是**有界异步并发**。
- **优化 ①：连接池真正生效（`server/db.ts`）**：新增 `resolvePoolSize()`（`DB_POOL_SIZE` 覆盖，默认 10、上限 64），drizzle 连接补 `waitForConnections:true` / `connectionLimit` / `maxIdle` / `idleTimeout:60s` / `queueLimit:0` / `enableKeepAlive` / `keepAliveInitialDelay:0` / `connectTimeout:20s`。
- **优化 ②：SQL 下推粗筛超集（`server/datasetRegistry/detection.ts`）**：新增 `LIMIT_UP_CANDIDATE_SQL_PREDICATE` = ``(`closePrice` >= `preClosePrice` * 1.045 OR (`preClosePrice` < 1.00 AND `closePrice` >= `preClosePrice`))`` + JS 等价实现 `isLimitUpCandidateBar(close, preClose)`（**测试夹具与生产 SQL 同语义**，漏判类错误在单测即暴露）。**1.045 阈值的安全性有数值证明**：`exchangeLimitUpPrice(pc, r) = Math.round(pc*(1+r)*100)/100`，枚举昨收（分）k ≥ 100 时 `Math.round(k*1.05)/k` 的**最小值 = 1.0458716**（k=109）> 1.045，余量 **0.083%**；k < 100（昨收 < 1 元、面值退市股，涨停价可能 == 昨收、比值低至 1.0）由 **guard 子句**兜住不筛。**不四舍五入即判定的旧路已在 DATASET-003B 实测漏判 38.03%（4,325 封板样本漏 1,645）**，本谓词只做**粗筛**、精确判定仍由 `isLimitUpClose` 内存完成，故不引入任何口径变化。
- **优化 ③：定向取数替代整段全市场（`server/datasetRegistry/db.ts`）**：新增 `fetchBarsForSymbolsInRange(symbols, from, to)`（`chunkArray` + `inArray` + 并发，结果按 `tradeDate, symbol` 排序）与 `fetchLiquidityForSymbolsInRange(...)`（批量 `inArray(securityCode)` + `gte/lte(tradeDate)`，Key = `liquidityKey(symbol, tradeDate)`）；新增 `monthShards(startDate, endDate)`（自然月切分 + 边界夹取）供 `fetchLimitUpCandidateBars` 在 > 1 月时**月度并发**（并发 12 → 3,903ms）。**删除**已无调用方的 `fetchBarsForDay` / `fetchBarsRange` / `fetchSymbolBars` / `fetchLiquidity` / `fetchLiquidityForSymbols` / `fetchIndustry` / `fetchIndustryForSymbols`。
- **优化 ④：分片细化（`server/datasetRegistry/builder.ts` 性能重构，零口径改动）**：Phase 1 改三段式 —— A 一次范围下推取候选（`factStartIdx = max(0, startDayIdx - max(maxLookbackDays, 1))`，**左边界预热保留**）；A2 负锚点时按「曾涨停 symbol 集合」经 `fetchBarsForSymbolsInRange` 补取事件日 bar（按 symbol 去重 `Object.assign`）；B+C 按 `EVENT_CHUNK_DAYS` 分片，**片内纯内存筛选 → 按 symbol 批量富集 → 装配 → 落库 → `flush(chunkEnd)`**。Phase 2 按 `PATH_CHUNK_DAYS` 分片，片内先收集 `symbols` 再定向取数，`flush` 改 4 张表 `Promise.allSettled` 并发写。`limitUpDays` 内部由双标量改为 `Map<string, Set<number>>`（resume 时 checkpoint 事实与本轮重分类事实重叠，`Set` 天然去重，避免 `countLimitUpBefore` 多计）。**`flush` 只上报已落库日期**，`limitUpDays` 快照只含 `d <= throughDayIdx`（resume 安全性不变）。
- **优化 ⑤：大表全量内存索引（`server/datasetRegistry/db.ts`）**：ST 区间 + `industry_assignments`（5,212 行）改由 `loadSecurityIndexes()` 一次载入（`SecurityIndex` = `identifiersByCode` + `stBySecurity` + `industryByCode`），新增 `resolveStSync` / `resolveIndustrySync`（行业口径：`effectiveFrom <= tradeDate` 中**最早**且 `effectiveTo` 为 null 或 ≥ tradeDate），逐 bar 解析 O(1) —— 省掉 242 天 × 0.77s ≈ **186s** 往返。原 `stIndex` / `buildStIndex` 删除。
- **进度分母一致性（自查修正，非测试暴露）**：runner 的 `phase2Total = 窗口交易日数 + 事件数`，故 builder 的 `completedChunks` 必须按**同单位**递增 —— 初版 Phase 1 每片 `+= 1` 会把进度压成 ~5%，已改为 `+= chunkEnd - chunkStart + 1`；Phase 2 改为 `+= 该片事件数`。
- **接口变更同步面**：`server/datasetRegistry/index.ts` 新增 `export * from "./concurrency"`；`testHelpers.ts#makeFakeIO` / `builder.test.ts#MemIO`（`fetchLimitUpCandidateBars` **复用 `isLimitUpCandidateBar`**）/ `scripts/verifyDataset003a.mts#ProbeBuildIO` 同步适配。
- **新增 `scripts/verifyDatasetBuildPerf.mts`（5 阶段，默认跑 S1~S4；`--stage=` / `--keep`）**，**真实 DB 实测 S1~S4 共 21 项断言全过（21/21、失败 0）**：**S1** 阈值数值证明 3/3（昨收 ≥ 1 元零例外 / guard 覆盖 25 处低价位 / 超集硬性质：4 种涨停比例 × 10 万价位，`isLimitUpCandidateBar(exchangeLimitUpPrice(pc, r), pc)` **恒为 true 零漏判**）；**S2** 下推补集证明 —— `下推候选 100% 覆盖全量判定结果（零漏判）A=1585 B=1585 差集=0`、`全量 112,349 行/14,118ms（21 次往返）→ 候选 6,598 行/2,563ms（1 次调用），压缩 17.0×`、候选经精确判定后**无假阳性**（纯度 24.0%）；**S3** 定向取数等价 —— `定向 16,367 行 与 全市场 219,455 行（筛后 16,367 行）逐行一致`、`219,455 行/93,190ms → 16,367 行/9,397ms，压缩 13.4×`；**S4 端到端等价（核心判据）** —— 用**新 builder** 重建 v1 窗口（2026-08-01~08-31 / main / 排除 ST / pre=20 / post=20 / horizons=5,10,20）与既有 v1 逐表比对：**五表 60,002 行（event 1130 / prefix 23730 / post 15876 / path 15876 / outcome 3390），行数一致 + 内容指纹一致 + 行级多重集差集 0 行（逐字节等价）**，耗时 **25.3s**、2,368 行/s、44.6 事件/s；临时版本级联清理**零残留**。另有 `npx tsc --noEmit` **exit 0**、`vitest run server/datasetRegistry` **12 文件 / 187 例全过**。**S5**（2024 全年长窗口吞吐）默认跳过。
- **🔴 关键教训 ①（S4 首轮假阴性的根因）**：S4 首轮报「五表行数逐表一致但**内容指纹全部不等**」，一度疑似口径漂移。**根因是比对脚本自身缺陷** —— `tableFingerprints()` 把 **`datasetVersionId` 也算进了指纹**，而两版本的该列**天然不同**（390001 vs 450001）。两个版本写入的是**同一批物理表**（仅 `datasetVersionId` 不同）→ 列类型完全一致 → `CAST(col AS CHAR)` 对相同值的渲染必然相同 ⇒ **指纹不等只可能来自真实数据差异**，据此逐层收敛到该列。修复（排除 `id`/`createdAt`/**`datasetVersionId`**）后逐列指纹 **0/15、0/10、0/10、0/12、0/7 差异列**。**顺带把判据升级为更强形式**：新增 `rowMultisetDiff()`（两版本行哈希合并后取计数为奇数的桶）——指纹只证「总和不冲突」，**行级差集为 0 才证「每行都能在对面找到逐字节相同的对应行」**，已固化为 S4 常驻断言。
- **🔴 关键教训 ②（既有结论被错误外推）**：`_limitprecision_probe.mjs` 只读 `stock_daily_prices`，测的是**旧判定谓词对原始行情**的漏判率 ≈38.03%，**从未读过 `ds_*` 表**；但 ROADMAP 由此外推为「既有 `ds_*` 仍是旧口径、不可用于策略结论」，该外推**已被本次实查否证**（详见 §44 头部「同期实查修正既有结论」）。**教训：谓词级的缺陷度量不能直接外推为**已落库数据**的属性，必须回到目标数据本体取证。**新增 `scripts/verifyLimitUpCaliber.mts` 把该审计固化为可复现断言**（8 项：五表物化完整性 / `limitUpPrice` 恒等于权威函数 / 含向下舍入样本 / 向下舍入样本与原始行情逐一对上），当前 **7/8 PASS**（唯一失败项 = v2 构建不完整，见下）。命中该外推的可执行判据：**若某版本事件集含「向下舍入型」样本，它就不可能是未舍入旧口径的产物**（旧口径下 `close = 舍入值 < 未舍入阈值` 必然判否）。
- **🔴 关键教训 ③（工具环境坑，供后续会话避雷）**：① `npx tsx -e "..."` 在本项目**静默无输出**（退出码 0），临时探针请落成文件运行；② 临时探针**不要 `import` `server/data/boardRules.ts`** —— 它会拉入 `server/engine/execution` 的整个回测引擎依赖图，导致探针**挂起**（实测被 SIGTERM）；需要 `exchangeLimitUpPrice` 时内联等价实现即可；③ 本地 `bash` 管道读 ROADMAP 会因编码（UTF-8/GBK）显示乱码，**读写该文件一律用工具而非 `sed`/`head`**。
- **验证汇总**：`npx tsc --noEmit` **exit 0**；`vitest run server/datasetRegistry` **12 文件 / 187 例全过**；`scripts/verifyDatasetBuildPerf.mts` **S1~S4 21/21**；`scripts/verifyLimitUpCaliber.mts` **7/8**（唯一失败 = v2 不完整，属真实发现）；临时诊断版本（420001/450001/450002）**全部级联清理、`dataset_version` 仅剩 v1/v2 两行**。
- **交付物**：新增 `server/datasetRegistry/concurrency.ts`、`scripts/verifyDatasetBuildPerf.mts`、`scripts/verifyLimitUpCaliber.mts`；重写 `server/datasetRegistry/builder.ts`；修改 `server/datasetRegistry/{detection,db,index}.ts`、`server/db.ts`、`server/datasetRegistry/{testHelpers.ts,builder.test.ts}`、`scripts/verifyDataset003a.mts`。**未新增 migration、未改任何表结构、未改任何判定/筛选口径。**
- **遗留 / 下一步**：① **同窗口「旧 vs 新」端到端 A/B 基线未采集**（HEAD 为 DATASET-001 时代代码、3 表且无筛选能力，不可比）→ 提速证据取组件级压缩比与并发标定，**不宣称端到端倍数**；② 🔴 **v2(390002) 构建不完整**（仅 event 表 13,579 行，其余四表全 0、`status` 永久 `BUILDING`）→ 需先修 `runner.ts` `completeJob → markReady` **两次写库非原子**（合并单事务），再补完构建；③ 未用 `worker_threads`（无必要，见上）；④ `--stage=5` 长窗口吞吐实测未跑。

### 2026-09-11 19:00 — WORK BACKTEST-RISK-001 组合回测页风控优化（高位连板约束 + 历史缺失字段降级；`/backtest`）

- **用户需求**：「优化现有组合回测页面」两项 —— ① 策略对**高位连板股**风险约束不足（已连续五、六板的回撤风险远大于潜在收益，却仍产生买入信号），需**限制参与或降低仓位**；② **2025-11 前**大量数据缺 `涨停时间`/`涨停关键词`/`所属板块`，需识别并**合理降级**，且**不影响 2025-11 之后数据的原有处理逻辑**。要求：先梳理代码结构 → 说明修改方案 → 再实现，尽量不影响回测页其他既有功能。
- **定位到两个真实根因（口径缺陷，不是「参数不够」）**：① `server/downsideRisk.ts#calculateRiskContributions` 旧口径把 `boards >= 4` **一律记 20 分** ⇒ 5/6/7 板与 4 板等价，而硬过滤（`riskScore >= 65`）与质量门控只看风险总分；② `normalizeSectorName` 把**缺失 sector 兜底成同一个「其他」题材** ⇒ 整日缺失记录聚合成**数百只巨型题材**，虚增题材共振得分、令「题材支撑不足」永不触发、「封板偏晚」误报 —— **缺失被当成了强度证据**。
- **新增两个 shared 纯函数模块（唯一口径，无 IO、可单测）**：`shared/boardHeightRisk.ts`（阶梯风险分 3/4/5/6/7+ 板 = **12/22/34/46/60**，2 板 5、≤1 板 0、**7 板以上封顶 60**；`isBoardParticipationRestricted(boards, max=6)`；`boardHeightPositionScale` → 5 板 0.6 / ≥6 板 0.3 / 越上限 0）；`shared/fieldAvailability.ts`（`hasFieldValue` / `isFieldCoverageReady`（阈值 0.6）/ `buildFieldCoverage(ByDate)` / `buildFieldCoverageReport` / `resolveThemeWithFallback`）。**不变量：缺失既不作风险证据、也不作强度证据。**
- **三管齐下（Strategy → PositionSizer → RiskPolicy → Backtest Core 分层未被打破）**：① 风险分层 —— 阶梯分进入 `calculateRiskContributions.boards`；② 限制参与 —— `selectQualityGateProfileKeys` / `selectQualityGateRowKeys` / `buildTradeDifferences.hardFilterExcluded` 增 `isBoardParticipationRestricted` 门槛，**`baseline` 恒不施加**（对照基准语义必须保留）；③ 降仓 —— 新增 `LeaderCandidateBacktestRow.positionScale`，在 `server/realisticBacktest.ts` 的 `plannedBudget` 上向下缩放，**不改排序、不删候选**。顺带抽出共用 `buildStrategyExperimentRows(...)`（原有 `buildExperiments` / `buildExperimentsWithWindowWeights` 两份重复口径收敛为一）。
- **缺失字段降级（`server/leaderCandidates.ts`）**：题材聚合**只并入可解析题材**，整日缺失用 `median(同日可解析题材家数)` 中性兜底（替代「灌进一个巨型题材」）；`sectorCount` / `limitUpTime` 按 `sectorAvailable` / `limitUpTimeAvailable` **可用才计分**；风险标签区分「本股缺失」vs「整段缺失（历史未采集）」；新增 `LeaderCandidateBacktestResult.fieldCoverage`；默认候选准入增 `sectorAvailable && limitUpTimeAvailable` 前提。`keywords` 打通（`server/db.ts` 两处 select 补列）。新增 tRPC 参数 `downsideRisk.maxParticipatingBoards`（zod `int 1~20` 可选，页面默认 6）。
- **前端（`client/src/pages/Backtest.tsx`，纯增量）**：`BoardHeightRiskParamsCard`（参数页：梯度表实时预览「限制参与 / 降仓」+ 上限输入）、`FieldCoverageNotice`（overview/risk 页覆盖率提示条，**仅降级时出现**）、overview 新增 `[data-board-height-impact]`（各策略限制参与 / 降仓计数表）。**既有区块零改动。**
- **真实库端到端验证（2025-09-01 ~ 2025-12-31；临时探针 `_boardrisk_probe.mts` / `_missingfields_probe.mjs` / `_keywordrescue_probe.mjs` 跑完即删）**：4,678 条涨停记录；覆盖率各 0.6905；降级月份仅 `2025-09`（时间/板块/关键词 **0.0%**）。连板分布 1板:6 / 2板:54 / 3板:87 / 4板:60 / **5板:38 / 6板:22 / 7板:13 / 8板:7 / 9板:3 / 10板:2 / 11板:1 / 12板:1**（5 板及以上 **87 只**、7 板及以上 **27 只**）。风控生效：`riskPenalty` 降仓 87；`hardFilter` 限制参与 27 / 降仓 59 / 剔除 28；`qualityGate` 限制参与 27 / 降仓 32 / 剔除 130。**关键回归证据：2025-11 前 vs 后 平均评分 74.27 / 74.28、平均风险分 24.7 / 24.71 → 证明后段口径未受影响。**
- **验证**：新增 3 文件 **26 例**（`shared/boardHeightRisk.test.ts` 6 / `shared/fieldAvailability.test.ts` 10 / `server/boardHeightRiskControl.test.ts` 10）；聚焦套件 **5 文件 / 47 例全过，2.75s（不连库）**；`npx tsc --noEmit` **exit 0**。全量：改动前 `16 failed | 2897 passed` → 改动后 **`16 failed | 2981 passed (2997)`，失败文件集合完全一致**（8 文件，全为环境类：`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `researchRunRouter` / `tushare.secret` / `tushareTradingCalendar`）——**本次改动零新增失败**。
- **顺带修复（非本次需求）**：`server/backtestPage.test.ts` 曾因**外部并发编辑**把 `LeaderCandidates.tsx` 的历史明细表拆到新组件 `client/src/components/CandidateHistoryTable.tsx`（`"龙头/风险/净评分"`、`"风险分只使用每行信号日信息"` 两段文本随表格迁移）而红 2 断言 → 改法：该测试**合并读取两处源码**（断言强度不变），**未改任何被断言的产品代码**。
- **状态**：`CODE_READY`（前端 + 策略口径），**非 RESEARCH_READY** —— 阈值（6 板上限 / 0.6 覆盖率）为**经验值**、可由页面参数覆盖，**尚未做样本外寻优**；组合回测页属 research-legacy 边界（§44.4），**不得由本页产出正式策略结论**。**§44 无数据口径变化**（纯 UI + 策略层，未改任何 `ds_*` 或 Dataset 构建）。

### 2026-09-11 19:20 — WORK DATA-INTEGRITY-001 原始数据表「重复行」防线审计（重叠窗口回填幂等性核查）

- **用户疑问**：「短时间间隔几天成交的话，存原始成交的数据表会有重复吧？」——即**重叠窗口回填**（今天补 08-01~08-10、明天补 08-05~08-15）是否会在原始行情表累积重复行。
- **结论：原始行情表不会重复**（真实库判据，非代码推断）。防线是「**DB 级唯一约束 + `ON DUPLICATE KEY UPDATE` 幂等覆盖**」，不是应用层 if-duplicate 判断：
  - `stock_daily_prices`(8,893,077 行) / `liquidity_daily`(9,015,158) / `corporate_actions` / `adjustment_factors` / `index_daily` / `industry_assignments` / `backfill_checkpoints` / `stock_suspension_windows` —— **真实库 `information_schema` 均存在覆盖业务键的 UNIQUE 索引**（已逐表核实索引名，如 `uq_stock_daily_price_stock_date`）。
  - 唯一写入口均走 upsert：`server/db.ts#upsertStockDailyPrices`、`server/marketData/liquidityStorage.ts`、`server/marketData/industryStorage.ts`（`.onDuplicateKeyUpdate(...)`）。⇒ 重叠窗口 = **同键覆盖**，幂等，行数不增。
  - 实测按业务键 `GROUP BY ... HAVING COUNT(*)>1`：上述大表**零重复组**。
  - 补充：`stock_daily_prices` 的唯一索引由 `ensureStockDailyPricesUniqueIndex` **惰性创建**（幂等；若历史库有脏数据则先删同键较大 id 行再补建约束）；位图索引 `registerSyncedPricePairs` 是**幂等置位**，重复回填不会污染索引。
  - ⚠️ 唯一真实代价：`ON DUPLICATE KEY UPDATE` 会刷新 `updatedAt`/`sourceUpdatedAt` 并触发 `invalidateLeaderCandidateBacktestCaches()` ⇒ 重复回填表现为**缓存抖动**，不是数据重复。语义上「后写入者胜、与数据新旧无关」，但 Tushare 未复权历史日线值不随时间变化，故当前无实质风险。
- **但审计发现两处真实缺口（均在「非行情」表）**：
  1. **`research_security_status_history` 缺 UNIQUE(securityId, statusType, effectiveFrom)** —— 真实库**仅有 PRIMARY**。当前实测**0 重复**（此前一度怀疑的「11 组冲突」是我探针按 `(securityId, effectiveFrom)` 分组的**假警报**：这些行实为不同 `statusType`，而 `resolveSecurityStatus` 正是先按 `statusType` 分组）。但 `server/securityStatus/timeline.ts#pickLatest` 在同键多行时以 `retrievedAt` → `source.localeCompare` 做 tie-break，语义上是「任取」⇒ **缺约束意味着一旦写入重复，PIT ST 判定会退化成「由 source 名字字母序决定涨停比例是 5% 还是 10%」**。**待修**（DDL，须按 §迁移流程：`drizzle/schema.ts` 声明 → 手写 `drizzle/NNNN_*.sql` → 幂等 `applyXxx.mjs`）。
  2. **`limit_up_records` 无业务唯一键**（仅 PRIMARY），且**已累积重复**：26 组 / **166 行多余**。其中 **258 行含「测试」字样**（`测试股票`/`测试题材`/`测试关键词`、`createdBy=1`），最重一组 = **`2024-12-31 / 000001.SZ` 重复 142 条**（`createdAt` 2026-01-10 ~ 2026-09-04 反复插入），其余散布于 `2026-07-21`(7) / `2026-07-09`(4) / `2026-05-25`(4) / `2026-05-11`(4) 等。
     **影响已确认（非推测）**：这些日期**均落在回测窗口（2019-01-02 起）内**，而 `server/db.ts#getLimitUpCountsByDate` 用 `COUNT(*)` 按 `limitUpDate` 聚合、`#getDailySectorStats` 统计题材热度、`server/marketRegimeRouter.ts` 以涨停家数驱动市场情绪 regime ⇒ **涨停家数被夸大 166 行（99,577 → 实为 99,411）**，`2024-12-31` 当日由 44 只虚增成 186 条。
     **待用户确认后清理**（破坏性操作，未执行）。
- **新增只读护栏脚本 `scripts/verifyRawDataUniqueness.mts`**：U1 约束存在性（`information_schema`，含「唯一索引存在 ⇒ 重复不可能写入」的逻辑证明，避免对 889 万行做大表全扫）/ U2 仅对**无唯一键**的表做实测 `GROUP BY` 重复扫描（真正的风险集）/ U3 测试数据污染扫描。实测 **9/11 通过**，2 项失败即上述两处缺口；`npx tsc --noEmit` 全库 **exit 0**。
- **§44 无数据口径变化**；**未新增 migration、未改任何表结构、未删除任何数据**；一次性诊断探针（`_dupProbe*.mts`）跑完即删。

### 2026-09-11 19:35 — WORK DATA-INTEGRITY-002 `limit_up_records` 连板高度口径审计（「多日间隔入库」的真实代价）

- **问题起点（用户提问）**：「同一只股票在多个交易日、中间有间隔地涨停，表里会有重复吧？」
- **实查结论一：多日间隔涨停本身不产生重复行。** 全表 99,577 行 / 1,867 个交易日 / 4,324 只股票（`2019-01-02` ~ `2026-09-10`，表为**活表**——抓取自动化每日在写）；**3,726 只股票有 ≥2 个不同涨停日**，按 `(limitUpDate, stockCode)` 分组仅 **26 组多行 / 166 行多余**，其中 141 行是「测试」污染（唯一一组 = `2024-12-31/000001.SZ`），**真实重复只有 25 组 / 25 行**。「一股一交易日一行」是本表的正确语义，**不是重复**。
- **实查结论二（真问题）：`boardCount` 与实际使用的连板高度是两套口径。**
  - `boardCount` 是**写入时各自算的文本**，两套约定并存：`scripts/backfillLimitUpRecords.mjs` 写 `首板`/`N天N板`（N = 连续板数）；`routers.ts#uploadAndRecognize`（复盘图 OCR）直接抄图上的 `1`/`N天M板`（N 天窗口内 M 个板，**可含间隔**）。实测 99,428 行（剔测试占位行）：空 2 / 首板 62,298 / 纯数字 10,744 / `N天N板` 24,088 / `N天M板`(M<N) 2,290 / 其他 6。
  - 而页面与统计真正使用的连板高度**不读该字段**：`server/db.ts#calculateConsecutiveBoards` 在读取时以「表内出现过的 `limitUpDate` 集合」为日期基准做**邻接链重算**。
  - 🔴 **邻接链要求链上每个交易日都有该股记录** ⇒ **只要某天缺行（未上传 / 未回填 / 被 ST 过滤 / 停牌未记），连板链就在那里断，连板高度被低估为「首板」**。这正是「按日期区间**间隔分批**入库」的直接代价，并向下影响涨停梯队分布 / `leaderCandidates` / 高位连板风控。
- **真实数据证据（新增只读护栏 `scripts/verifyBoardHeightCaliber.mts`，实测 1/4 通过）**：
  - 🔴 **H3-缺口 133 行**：`N天N板` 自称的连续板数 **> 表内实际连续天数**（如 `000078.SZ 2025-12-02 自称 5 连板、表内只有 1 天 → 中间缺 4 个交易日记录`）。缺口最多的交易日：`2026-01-12`(12) / `2026-08-04`(8) / `2025-12-02`(4) / `2026-04-29`(4)。
  - 🔴 **H3-断裂 30 行**：`boardCount="1"` 却已连续 ≥2 天，**全部来自 OCR 链路**（`backfill=0 / ocr=30`）。
  - 🔴 **H5 同日多行 25 组 / 25 行多余**：24 组内容不同（**同一批次写入、同一股票被复盘图里多个题材段落各识别一次** —— 如 `002990.SZ 2026-05-07` 两行 sector 分别是「光通信*14」「算力租赁*12」，`createdAt` 同一秒），1 组逐列完全相同（真重复）⇒ `getLimitUpCountsByDate`(`COUNT(*)`) 与连板梯队分布被虚增。
  - ✅ **H2 通过**：`index_daily` 日历区间内 `limit_up_records` 的日期**全部是真实交易日**；`2026-09-07~09-10` 晚于 `index_daily` 尾部 `2026-09-04`，属**指数域同步缺口**（非本表口径错误），但同样会让这几天的连板链缺少基准。
- **潜在（尚未在数据中显现）的代码缺陷**：`backfillLimitUpRecords.mjs#main` 在 `const fresh = hits.filter(h => !existing.has(...))` 之后，连板 `streak` **只在 `fresh`（本轮新增）上推进，不参考已在库的历史** ⇒ 与「已声明的幂等性」不同，**只要按间隔区间分批回填，区间衔接那天的连板数会被错误重置为「首板」**。当前数据未显现（回填是一次性跑完的），但缺陷已存在。修法 = 连板判定改用「已在库历史 ∪ 本轮新增」的并集，且日期基准改用 `index_daily` 真实交易日历。
- 🔧 **顺带更正上一轮（DATA-INTEGRITY-001）的一处过宽判据**：`limit_up_records` 的「测试污染」原记 **258 行**是**误报** —— `LIKE '%测试%'` 会命中**真实股名**（`谱尼测试`、`西测测试`）与**真实涨停关键词**（`封装测试`、`芯片测试设备`）。改用前缀 `LIKE '测试%'` 后真实污染 = **143 行，全部是 `000001.SZ 测试股票`**（`2024-12-31` 142 行 + `2025-12-31` 1 行，均为 `测试题材`/`测试关键词` 占位）。`scripts/verifyRawDataUniqueness.mts#U3` 已同步改为前缀口径并打印宽/严两个数字（9/11 通过，2 项失败不变）。
- **§44 无数据口径变化**；**未新增 migration、未改任何表结构、未改任何写入逻辑、未删除任何数据**；一次性诊断探针（`_lupProbe.mts` / `_boardProbe*.mts` / `_imgProbe.mts` / `_tp.mts`）跑完即删；`npx tsc --noEmit` 全库 **exit 0**。
- **待用户拍板（均未执行）**：① 修 `backfillLimitUpRecords.mjs` 的 `fresh`-only 连板计算；② 补 `limit_up_records` 业务唯一键（须先定语义：同股同日多时段 / 多题材是否合法）；③ 补数据缺口（补齐缺失交易日的上传/回填）；④ 清理 143 行测试占位数据。

### 2026-09-11 19:38 — WORK DATA-INTEGRITY-003 数据集 `ds_*` 物理表「多日（间隔）涨停是否产生重复」实查

- **触发**：用户追问「同一只股票**多日内有间隔**地涨停，**数据集里面的表**会不会有重复」（承 DATA-INTEGRITY-001/002 的口径澄清）。
- **结论一：`ds_*` 五表行级「零真重复」**（真实库 + `information_schema` 双证）：
  - 真实库唯一键**齐备**：`ds_first_limit_pullback_event` `UNIQUE(datasetVersionId, eventId)`；`prefix`/`post`/`path` `UNIQUE(datasetVersionId, eventId, relativeDay)`；`outcome` `UNIQUE(datasetVersionId, eventId, horizon)`。
  - `eventId = computeEventId(symbol, tradeDate) = "symbol@tradeDate"`（**确定性派生**，`detection.ts#computeEventId`），且全部插入走 ON DUPLICATE KEY ⇒ **幂等**。
  - 实测 `GROUP BY ... HAVING COUNT(*)>1`：**五表重复组全为 0**；`event` 按**自然键** `(symbol, tradeDate)` 亦 **0 组**（v1 与 v2 均验）。
  - ⇒ **同一股票多次（含间隔）涨停 = 多个不同 `eventId` 的事件、各占一行，不是重复行。** v1 中有 **227 只股票有 ≥2 个事件**（最多 `601700.SH` 7 次：08-03/08-10/08-12/08-17/08-20/08-24/08-28，间隔 2~4 个交易日），全部为合法独立事件。
- **结论二：但「事件窗口必然互相覆盖」——同一根 K 线会以不同 `(eventId, relativeDay)` 被存多份**（**结构性冗余、语义必需**，因为每个事件需要**自己的相对日**）：
  - v1 实测（`prefix` 23,730 / `post` 15,876 行）：`prefix` 不同 K 线 19,160、被存 >1 次 3,601 根、**冗余 4,570 行（19.3%）**；`post` 不同 K 线 12,636、被存 >1 次 2,524 根、**冗余 3,240 行（20.4%）**；**同一 K 线同时出现在 prefix 与 post（跨角色）2,255 根**。
  - 极端样本 `601700.SH`（窗口内 7 次涨停）：`prefix` **147 行只对应 40 根不同 K 线 ⇒ 73% 冗余**，同一根 `2026-07-31` 被存 **7 份**（rd=-20/-16/-14/-11/-8/-6/-1）。
  - ✅ **同源一致性已证**：上述多份副本的 **OHLCV 逐字节相同**（`COUNT(DISTINCT CONCAT_WS('|', open,high,low,close,volume,amount)) > 1` 的组数 = **0**）⇒ 是「同一行情源的多份引用」，**不是「同一根 K 线两套值」的数据污染**。
  - 🔴 **使用侧禁令（本轮新增约定）**：① **禁按 `(symbol, tradeDate)` 去重** —— 不同事件对同一根 K 线的 `relativeDay` 语义不同（如 `601700.SH 2026-08-03` 既是事件日 `rd=0`，又是 08-10 事件的 `rd=-5`），去重会静默合并语义；② 窗口表**行数不可当独立观测数**做聚合（会重复计数）。
- **固化**：`scripts/verifyDatasetWindowLayering.mts` 新增两条常驻断言 —— **I7b**「`event` 自然键 `(symbol, tradeDate)` 唯一」（**纵深防御**：线上唯一键建在派生字符串 `eventId` 上，若将来 eventId 生成规则变更，DB 层保护会静默消失）；**I12**「窗口重叠副本同源同值」。另打印结构性重叠冗余率（信息性，不断言）。逐字复刻 SQL 已在真实库独立验证：**I7b=0、I12=0**（v1/v2）。
- ⚠️ **验收脚本本轮未能跑完**：`shared/researchContracts.ts` 正被**另一并发会话**编辑，出现 `Cannot access 'metricsEvaluateInputSchema' before initialization`（错误行号在我操作期间由 533 漂到 654，说明仍在写入）；该文件被 `shared/datasetRegistryContracts.ts` import ⇒ 任何引 `datasetRegistry` 的脚本都会 **import 期崩溃**。**与本次改动无关**（我未触碰该文件）；其恢复后需补跑 `verifyDatasetWindowLayering.mts`。
- **§44 无数据口径变化**；**未新增 migration、未改任何表结构、未改任何判定/筛选口径、未删除任何数据**；一次性诊断探针（`_dsdupProbe*.mts`）跑完即删；`shared/researchContracts.ts` 的编译错误**非本次引入**。

### 2026-09-11 20:27 — WORK DATASET-LIFECYCLE-001 数据集「取消构建 → 重新构建」数据完整性实查（v2 卡死根因确证）

**结论：取消构建在数据层面不是「回滚」，是「暂停」；重新构建也不保证干净 —— 两个真实风险已在真实库实测坐实。**

**一、取消的实际语义（实测）**
- `registry.ts#cancelJob` 只改状态：Job `RUNNING → CANCELLED`、Version `BUILDING → FAILED`；**已落库的 `ds_*` 行一行不删**（`db.ts` 无任何 DELETE/TRUNCATE，构建路径全程只有 upsert）。取消 = 数据层暂停。
- router `cancelBuildJob` 顺序为「先 `service.cancelJob`（落库）→ 再 `runner.cancel`（置内存标志）」，而 builder 只在**下一个 report 回调**才抛 `DatasetBuildCancelledError` ⇒ 取消与 flush 之间存在竞态，取消瞬间仍可能有批次落库。

**二、重新构建的两个真实风险（哨兵实验，临时版本 480002）**
- 重建走 `resumeCheckpoint: null`（`runner.ts` **从不续跑、每次从零重建**），插入为 `ON DUPLICATE KEY UPDATE id = id` —— **空更新（no-op）**，不是「后写覆盖」。
- **风险 A（旧行不清理）**：注入伪造事件 `999999.SZ@2026-08-15` 后重建 → **该行仍存在**，event 表 1131 行（v1 为 1130），而 `version.totalEvents` 仍写 1130 ⇒ **声明行数与实际行数脱节**。
- **风险 B（旧值不修正）**：篡改 `000006.SZ@2026-08-13` 的 `industryCode='SENTINEL_IND'`、`turnover=999999.99` 后重建 → **旧值仍胜出**（no-op 未覆盖）⇒ 两次构建之间若上游数据/代码变化，新值被**静默丢弃**，数据停在旧状态（新旧混合）。
- **对照（无变化时是好的）**：同窗口下 prefix/post/path/outcome 四表**行级差集 = 0**（vs v1 逐字节等价）⇒ 重建的「产出正确性」没问题，问题**只在陈旧残留**。

**三、🔴 v2(390002) 卡死根因确证（本项目首个已发生的死锁）**
- 真实作业时间线：`job1` CANCELLED（started 2026-09-10 12:38:19 → cancelled 2026-09-11 11:43:10，用户等待约 23h 后取消）→ **27 秒后 `job2` 重建启动**（11:43:37）→ `job2` **`updatedAt=2026-09-11 11:47:27` 之后再无任何进度更新**（`processedRows=85325`、`chunks=200/484`），但状态**永久停在 RUNNING**（审计时已停更 39 分钟）。
- 根因：`DefaultDatasetBuildRunner` 的运行态/取消标志是**进程内内存 map**，且**全库无「启动时回收孤儿作业」逻辑**（`listJobs` 仅用于查询展示、`getRunningJobForVersion` 仅用于守卫）⇒ 进程重启/热重载后，DB 里 RUNNING 的作业**无人接管、永不终态**。
- 后果（实测确认为**死锁**）：`createJob` → `VERSION_NOT_BUILDABLE`（版本 BUILDING 不可建作业）；`deleteVersion` → `VERSION_HAS_RUNNING_JOB`（存在 RUNNING 作业不许删）⇒ **v2 既不能重建、也不能删除**。

**四、新增只读护栏 `scripts/verifyDatasetBuildLifecycle.mts`（L1~L3，实测 5/6）**
- L1a 无停更超时的 RUNNING 作业（**当前唯一失败项** = v2 幽灵作业）/ L1b 无「BUILDING 但无 RUNNING 作业」/ L1c 无「有 RUNNING 作业但版本非 BUILDING」/ L1d 每个 READY 版本有 COMPLETED 作业；
- L2 版本 `totalRows`/`totalEvents` 与物理表实际行数一致（v1 60002/60002、1130/1130 ✅；v2 声明 null）；
- L3 输出可用于研究的版本清单（当前仅 **v1**；v2 因 `status=BUILDING` + 4 张非 event 表为空而排除）。

**五、修复建议（本轮未动手，全部为只读审计）**
1. **破 v2 死锁**：`UPDATE dataset_build_job SET status='CANCELLED' WHERE status='RUNNING' AND updatedAt < NOW() - INTERVAL 10 MINUTE` + 对应版本置 `FAILED` → 之后可重建（`FAILED → BUILDING` 合法）。
2. **治本①**：启动时（或定时）回收「RUNNING 且 `updatedAt` 停更超阈值」的作业 → 置 `FAILED` + 版本 `FAILED`。
3. **治本②**：让「重建」语义上真的重建 —— 构建开始时 `DELETE FROM ds_* WHERE datasetVersionId = X`（比把 upsert 改成真覆盖更稳，后者无法处理「本轮不再产出」的行）。
4. **治本③**：`completeJob → markReady` 合并单事务（既有已知项）；取消路径改为「先置内存标志 → 再落库终态」以缩短竞态窗口。
5. ⚠️ 顺带观察：本次实验构建耗时 **169s**（`batchSize=500`），显著慢于 S4 场景 ⇒ `batchSize` 是构建速度敏感参数，值得单独标定并固化到 `dataset_build_config`。

**未新增 migration、未改表结构、未改任何写入/判定逻辑、未删任何数据**；一次性诊断探针（`_cancelProbe.mts`/`_ghost.mts`）跑完即删，临时版本 480001/480002 均级联清理（零残留，`dataset_version` 仅剩 v1/v2）。

- **2026-09-11 21:05 GMT+8 — WORK RESEARCH-002C 批量建分析交付（降低「建分析」重复劳动；零数据依赖）**。用户原话：「现在初步看起来分析研究是能用了，但是我需要手动建立很多分析，有没有什么办法可以减少这个过程」。**重复劳动的两个来源（以代码为证）**：① `researchEngine.createAnalysis` 端点入参是**单个** `createAnalysisItemSchema`，前端 `CreateAnalysisDialog` 的特征 / 目标 / 视界均为**单选**控件 ⇒ 组合类研究要一轮轮建；② 建完还得**单独点「补跑」**（`createRun` 只建不执行、**无后台 worker/cron 消费 `PENDING` Run**；`RUN_NOT_PENDING` 守卫禁用 `COMPLETED` 覆盖，新增分析只能走 RESEARCH-002B 的 `runIncremental`）⇒ 典型场景「5 特征 × 3 视界 + 1 稳定性 × 3 维度」= **N 轮表单往返 + N 次补跑**。**用户两项拍板**：路线 = **A 批量矩阵创建 + B 一键标准研究套件 + D 跨实验分析模板**（C「复制已有分析」不做）；执行 = **只创建，不自动补跑**（自己点）。**核心架构决策（防实现分叉）**：**三条路线共用同一条落库路径** —— 标准套件**不另写生成逻辑**，只是「用预设值填 `BatchMatrixFormState`」，交给与矩阵**同一个** `expandAnalysisMatrix` 展开；模板展开（`applyAnalysisTemplate`）与矩阵批量**都调 `createAnalysesBatch`**，故**预检整批拒绝 / 部分失败如实回显 / 失败补偿删除**三条语义**自动继承**，模板侧零重复实现。**两条设计纪律（错了就会留下半成品）**：① **预检整批拒绝、不产半成品** —— `assertBatchCreateItems` 在**写库之前**跑完 `preflightBatchCreateItems`，任一项不合法即抛 `BATCH_VALIDATION_FAILED`、**一个都不建**（消息显式含「未创建任何分析」+ 前 10 项 `第 N 项：<原因>`）；预检项 = 空批次 / 名称空或超 200 / 类型未在执行器注册表内 / CONDITIONAL 缺**有效**条件（`fieldName.trim() !== ""`，空字符串条件视同没有条件）；② **执行期部分失败如实回显 + 补偿删除** —— 逐项 `analyses.create` → 有条件的再 `conditions.replaceForAnalysis`；某项中途失败即**补偿删除**刚建的分析（**先删条件再删分析**，守零 FK 不依赖级联），计入 `failed`（带 `index` + 原始消息）；**补偿本身再失败**则如实追加「⚠️ 回滚该项失败：…」，**绝不静默吞掉** ⇒ `created` 列表每项保证「**有 id 就能跑**」（条件已落库）。**刻意不重复实现条件结构校验**：组的连续 0..n-1 / 组内 `sortOrder` 唯一 / 值元数等**结构性**合法性唯一权威是 `assertConditionSet`（由 `conditions.replaceForAnalysis` 写入时执行，`repository/db.ts:649` 真会调用），批量路径**只做预检级「有没有条件」判断**，不重造第二份规则。**模板形状 = 头 + 明细两表**（`research_analysis_template` / `research_analysis_template_item`，沿用 DATASET-003B 纪律：明细需**确定性顺序** + 可索引检索、头表需**唯一约束**——名字是「一键铺开」的不歧义引用基础）；**唯一例外**是明细的**条件**用 `conditionsJson`（**配置快照**，不索引不约束；为它建第三张表只会让模板读取变成三表 join 且换不来完整性收益）—— **口径不降级**：模板展开成真分析时，条件**仍写 `research_analysis_condition` 关系表**。**服务端实现**：`drizzle/0033_research_analysis_template.sql`（2 表 + 2 索引，头含口径长注释）+ `scripts/applyResearchAnalysisTemplate.mjs`（apply + **34 项断言**：列存在 / 类型 / `name` `varchar(120)` 非空 / 唯一约束 / 索引 / **零外键** + **10 张既有 research 表行数不变**；支持 `--dry-run` / `--check`，`--check` 幂等重放 PASS；**不写 `_journal.json`** —— 项目自 0024 起停止维护、手工补写属伪造）；`server/researchEngine/batchCreate.ts`（`MAX_BATCH_CREATE_ITEMS = 200`、`implementedAnalysisTypes()` **取自执行器注册表**而非硬编码、`preflightBatchCreateItems` / `assertBatchCreateItems` / `createAnalysesBatch`）；`server/researchEngine/templates.ts`（`assertTemplateDraft` 校验名 ≤120 / 至少一项 / 类型已实现 / CONDITIONAL 必须有条件；`templateItemsToBatchItems` / `batchItemsToTemplateItems` 双向转换，`readConditions` **逐行校验且具名指出第几项第几行**、**不静默丢条件**）；`server/researchEngine/types.ts` **+5 个错误码**（`BATCH_VALIDATION_FAILED`/`BATCH_TOO_LARGE`/`TEMPLATE_NOT_FOUND`/`TEMPLATE_NAME_CONFLICT`/`TEMPLATE_VALIDATION_FAILED`）+ `ResearchBatchAnalysisItem`/`ResearchBatchCreateResult`；`server/researchEngineRouter.ts`（684 → 约 800 行）**+5 个端点**（`createAnalyses`(admin) / `listAnalysisTemplates`(**public**，模板数量天然很小故**不分页**) / `createAnalysisTemplate`(admin) / `deleteAnalysisTemplate`(admin) / `applyAnalysisTemplate`(admin)）+ 5 条错误码映射（`TEMPLATE_NOT_FOUND`→NOT_FOUND；`TEMPLATE_NAME_CONFLICT`→CONFLICT；其余三个→BAD_REQUEST），并令 `createAnalysis` 复用 `createAnalysisItemSchema.extend({runId, metrics})` 使**单建与批量共用同一份 schema**；`server/researchCore/types.ts` + `ResearchAnalysisTemplateItem`/`ResearchAnalysisTemplate`（含「条件为何允许 JSON」注释）；`server/researchCore/repository/contract.ts` + `ResearchAnalysisTemplateRepository`（`create`/`getById`/`getByName`/`list`/`delete`）与 `ResearchRepositories.templates`；`db.ts` 用 `loadTemplateItems(ids)` **批量取明细避免 N+1**（排序 templateId→sortOrder→id）、重名预检 + `ER_DUP_ENTRY` 兜底 → `ResearchConflictError`、`delete` **显式先删明细**；`inMemory.ts` 用 `cloneJson` 深拷贝（**阻断调用方持引用改写内部状态**，与 `cloneLog` 同纪律）、`list` 按 `name.localeCompare` 排序。**前端实现**（沿用 `API(DTO) → Adapter → ViewModel → UI` 分层）：`client/src/components/research/analysisBatchForm.ts`（纯函数层：`createDefaultBatchMatrixForm` / `expandAnalysisMatrix`（DESCRIPTIVE 1 项、QUANTILE 每目标 1 项、CONDITIONAL 每目标 1 项且**无条件则整体跳过并说明**、EVENT_STUDY 1 项给全视界、STABILITY = 目标 × 维度笛卡尔积；`batchItemName` 对 STABILITY 追加 `→ ${target}` 防重名、`dedupeNames` 追加 ` #n` 兜底）/ `toBatchCreatePayload`（无 target/conditions 时**不发该键**）/ `buildSuitePlan`（视界取 `availableFutureReturnHorizons`、维度取 `catalog.dimensions`，**均不硬编码**）/ `templatePreviewRows`（**不推导、不改名**）/ `validateBatchMatrixForm` / `validateTemplateName`）；`BatchAnalysisDialog.tsx`（三 Tab：矩阵展开 / 标准套件 / 我的模板；共用 `BatchPreview` **建前摊开清单** + `skipped`/`truncated` 如实回显；`outcome` 回显 `created`/`failed`；`saveAsTemplate`）；`client/src/adapters/researchEngineAdapter.ts` + `AnalysisTemplateVm`/`toAnalysisTemplateVm(s)`（防御性归一）+ 5 条 `ENGINE_ERROR_HINTS`；`ResearchDetail.tsx` 分析卡片并列「新建分析」与「批量建分析」。**客户端不可 import 服务端常量**（会把服务端拖进 bundle，项目有泄漏检查）⇒ `MAX_BATCH_ITEMS = 200` 是**显示用副本**，服务端 `MAX_BATCH_CREATE_ITEMS = 200` 才是权威。**本段修掉一个真实缺陷**：`createAnalysisTemplate` / `deleteAnalysisTemplate` / `applyAnalysisTemplate` 里 `throw new ResearchEngineError(...)` **直接抛、没走 `toTrpcError`** ⇒ tRPC **不自动映射领域错误**、一律落 `INTERNAL_SERVER_ERROR`（被 2 例路由测试失败暴露）→ 改为 `toTrpcError(new ResearchEngineError(...))`，与文件内既有 9 个 catch 分支约定对齐（**教训：新增端点时领域错误只能在 catch 里 `toTrpcError(e)` 或显式 `toTrpcError(new ...)`，直接 `throw` 不改 tRPC code**）。**验证**：`npx tsc --noEmit` **exit 0**（多次）；`node scripts/applyResearchAnalysisTemplate.mjs` **34/34 断言 PASS** 且 `--check` 幂等 PASS；新增 `server/researchEngine/batchCreate.test.ts` **16 例**（6 describe）、`client/src/components/research/analysisBatchForm.test.ts` **27 例**；`server/researchCore/repository/inMemory.test.ts` 32 → **38 例**（+6 模板仓储：排序 / trim / 重名 / list / 先删明细 / 深拷贝隔离）、`server/researchEngineRouter.test.ts` 32 → **43 例**（+5 批量建分析 + 6 模板）；聚焦回归（`server/researchEngine` + `server/researchCore` + `researchEngineRouter.test.ts` + `client/src/components/research` + `client/src/adapters`）**25 文件 / 450 例全过**；**全量 `vitest run` 211 文件 / 3189 例**（3174 通过 / **15 失败 / 7 文件**）—— **失败数与失败文件集合与基线逐项一致**（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`，全为既有环境依赖失败：Tushare token / 网络 / DB / 认证快照），**零新增失败**。**零数据依赖**：无回填、无 Dataset 重建、**未触碰 `ds_*` 物理表与 dataset 页面**、**未修改** `docs/researchReadyGate/research_ready_gate.json`。**产物**：`docs/research/RESEARCH-002-report.md` 新增 **§20（20.1 触发问题实录 / 20.2 三条交付路线 / 20.3 两条设计纪律 / 20.4 刻意不重复实现条件结构校验 / 20.5 模板形状 / 20.6 错误码与映射 / 20.7 新增端点 / 20.8 验收结果 / 20.9 实现中修复的缺陷 / 20.10 未做边界）** + 附录 A 新增/修改文件清单 + 附录 B 复现命令（2g）。更新 §44 头部实查快照 + §44.5 队列（9g）。

- **2026-09-11 21:35 GMT+8 — WORK DATASET-LIFECYCLE-001（治本落地）「取消 = 回滚 · 重建 = 从零 · 孤儿作业回收」三件套交付 + 真实库验收**。用户指令原话：「**根治这个问题，取消构建后就要删除数据**」。承接 20:27 实查（那轮是审计，本轮是落地）。

  **一、代码交付**
  - `runner.ts`：`DatasetBuildRunner` 增 `waitForStop(jobId, timeoutMs?)`；运行态由 `Map<string, BuildControl>` → `Map<string, BuildRun{control, promise}>`（`start()` 登记执行体 promise，其 `.finally` 负责摘除，且早于等待方被唤醒）；新增 `BUILD_STOP_TIMEOUT_MS = 60_000`（依据：最坏工作单元 = 月度候选下推实测 ~12.8s ⇒ ~4.7× 余量）；`execute()` 在 `builder.build` **之前**插入取消检查 + `await service.purgeVersionRows(versionId)`；**失败分支补 `console.error`**（原先 `catch {}` 完全静默 ⇒「版本 FAILED + 作业永久 RUNNING + 零线索」无从定位）。
  - `registry.ts`：Repository 契约增 `listRunningJobs()`（全库 RUNNING，跨数据集/版本）；新增 `purgeVersionRows()` / `cancelJobAndRollback()` / `reclaimStaleJobs()`；`DEFAULT_STALE_BUILD_MINUTES = 10`；结果类型 `CancelJobRollbackResult{job, rollback|null, rollbackSkippedReason, alreadyCancelled}`、`ReclaimStaleJobResult{..., rollbackSkipped}`；`InMemoryDatasetRegistry.updateJob/transitionJob` 补 `updatedAt` 刷新（与真实库 `ON UPDATE CURRENT_TIMESTAMP` 同语义，使孤儿判据在内存实现下真实成立）。
  - `physicalTables.ts`：`DatasetPhysicalStore.purgeVersionRows()` —— 分批 `DELETE ... WHERE datasetVersionId = X LIMIT 5000`；表不存在 → `tableMissing=true / deleted=0`（诚实 0，不冒充）。
  - `router.ts`：`cancelBuildJob` 固定顺序改写 + 回显真实清理结果；新增导出 `reclaimOrphanBuildJobs({staleMinutes?})` 供启动钩子复用。`server/_core/index.ts`：`server.listen` 后调用并逐条 `console.warn`（env `DATASET_RECLAIM_STALE_MINUTES`）。前端 `VersionBuildControls.tsx` / `VersionDetail.tsx` 按后端真实结果回显（有 `rollback` → success「已取消并回滚：清空 N 行」；无 → warning + 原因）。

  **二、真实库验收（证据链）**
  - 静态/测试：`npx tsc --noEmit` **exit 0**；`vitest run server/datasetRegistry` **12 文件 / 201 例全过**（199 + 本轮 2；新增关键词覆盖：RUNNING 取消清空 / 幂等重复取消 / COMPLETED 不可取消 / PENDING 取消 / 无 physicalStore 抛错 / 孤儿回收含 `staleMinutes<=0` 与「仍在刷新不回收」/ **READY 未接管不回滚** / **孤儿回收 READY 跳过** / waitForStop 立即返回 / 重建前清场）。
  - 审计：`scripts/verifyDatasetBuildLifecycle.mts` **7/7 通过**（新增 **L4**「非 READY 且无 RUNNING 作业的版本不得残留数据行」= 取消即回滚的常驻护栏）。
  - **P1 取消 = 回滚（真实孤儿作业，version 510001）**：`waitForStop` 报「已无写入者」→ 作业 CANCELLED → 版本 FAILED → **五表 128,176 行 → 0 行（18.1 s）** → 幂等重复取消不抛错（只补做回滚）→ 取消后**可直接重建**（`createJob` ok）→ **可直接删除版本**（`deleteVersion` ok）。死锁彻底解除。
  - **P2 重建 = 从零（哨兵实验，version 510004，1 月窗口 2026-08）**：B1 首次构建 180.4 s / 五表 60,002 行（`event=1130 / prefix=23730 / post=15876 / path=15876 / outcome=3390`）；**植入施工痕迹** —— 把锚点事件 `000006.SZ@2026-08-13` 的 `eventId` 改名为 `...-GHOST` 且 `limitUpPrice`/`turnover` 置 999999.9999；B2 重建 220.3 s ⇒ **幽灵行 0 行**（清场未生效则该行必然存活）、**锚点事件被重建且值为正确值**（`limitUpPrice=7.7 / turnover=2.8771`；空更新不会修回垃圾值）、**五表逐表行数与首次完全一致**、`version.totalRows = 60002` **声明 = 实际**。⇒ 「重建后新旧混合 / 声明≠实际」两个缺陷已消除。
    - ⚠️ 该探针有 1 条断言是我写错的（预期改名后行数 +1，实际改名不改行数）⇒ 属**探针断言设计错误**，与产品无关；决定性判据是「幽灵行 0 + 正确值覆盖」。
    - ⚠️ 探针中「prefix 表垃圾值已清除」一条为**空真**（我误把痕迹打在只存在于 `event` 表的 `-GHOST` 键上，未真正篡改 prefix）⇒ **不作为证据**。非 event 表的清场由 **P1 的「五表 128,176 → 0」** 直接证明。
  - **P3 死锁自动解困（生产已生效，非人工破锁）**：卡死 23 h 的 v2 幽灵作业 `540001` 被启动钩子回收（`errorMessage="orphan reclaimed：停更 55 分钟无进度更新"`）⇒ v2 由「既不能重建也不能删除」变为可重建；应用侧 21:24 已成功对 v2 发起重建（`job 630008`）。**生产数据零污染**：v1(390001) 仍 READY / events 1130 / rows 60,002。

  **三、顺带发现并修掉的真实缺陷**
  - 🔴 **「取消 READY 版本的重建」会静默销毁有效数据**：`runner.execute` 顺序是 `markBuilding`（版本→BUILDING）→ … → 清场 → build ⇒ **版本仍是 READY ⟺ 本轮尚未接管**；而原 `cancelJobAndRollback` **无条件清空** ⇒ 用户在点击构建后约 0.6 s（跨境 RTT × 4 次查询）内取消，即得到「`status=READY` 却 0 行」的**谎报态**（有效数据集被静默销毁）。已修为「READY 且本轮未接管 ⇒ **不回滚** + `rollback=null` + `rollbackSkippedReason` 诚实说明」，`reclaimStaleJobs` 用同一判据（`rollbackSkipped`）。

  **四、口径与副作用声明**
  - **未新增 migration、未改表结构、未改任何涨停判定 / 筛选 / 写入口径**；唯一新增副作用 = 取消、孤儿回收、重建前清场会**真删 `ds_*` 行**（这正是用户要求的语义）。
  - 边界诚实声明：`waitForStop` 只能等**本进程**登记的执行体；将来若多实例部署且同一作业被两进程执行，另一进程的在途写入无法被等到（当前单实例部署下不成立）。

  **五、未定位项（独立缺陷，另立，不并入本次交付）**
  - ⚠️ 上一轮探针曾两次观察到「Phase 1 结束后构建停止推进」（`chunks=21/21` 后 `processedRows` 不再增长、status 永久 RUNNING、`errorMessage` 空）。本轮**清理掉两组泄漏的旧探针进程**（20:46 / 20:59 启动的 `_cancelRollback.mts`，被工具层「停止」后底层 node 进程未退出）后**未再复现**（同一 1 月窗口 B1/B2 两次均正常 COMPLETED）⇒ 疑与「多进程争抢同一 TiDB」有关，**未确证**。定位手段已就位（`runner.execute` 失败分支现会打印 `[DatasetBuild] 构建失败 job=… version=…：<原因>`）。
  - 探针与临时版本清理：`_cancelRollback.mts` / `_rebuildCheck.mts` / `_peek.mts` / `_sentinelCheck.mts` / `_state.mts` 跑完即删；临时版本 510001/510002/510003/510004 全部级联清理（残留 0 行），`dataset_version` 仅剩 v1/v2。

- **2026-09-11 22:55 GMT+8 — 事故复盘 + 真实缺陷修复：孤儿 `RUNNING` 卡死（`RUNNING` 转换不清上一轮失败残留）；顺带更正 v2 状态**。**用户报错（22:42）**：`请求失败 RPC_ERROR / Failed query: select MIN(relativeDay), MAX(relativeDay) from ds_first_limit_pullback_path where datasetVersionId = ? params: 390002`。**一、逐条实查（以真实 DB + 进程为证，不采信推测）**：① **该 SQL 不是缺陷** —— `EXPLAIN` 显示走 `idx_path_version_day(datasetVersionId, relativeDay)` 索引边界扫描（`IndexRangeScan … keep order:true, desc` + `Limit count 1`）⇒ **O(1)**；实证单独跑 `getPathRelativeDayRange(390002)` **1.7 s**、`getVersionContext(390002)` **2.5 s**，均成功返回 `{min:1,max:20}`。② ✅ **更正旧状态：v2(390002) 已 READY 且五表齐备**（21:24 由 DATASET-LIFECYCLE-001 启动钩子解困后重建成功）—— events **23,978** / path **471,816** / outcome **71,934** / prefix 503,538 / post 471,816，窗口 2024-09-02→2026-09-01 ⇒ 本节队列第 10 条 ① 的「v2 构建不完整、永久 BUILDING」**已作废**。③ **用户 Experiment 240002 / Run 330003 真实时间线**（应用侧时间）：22:40:21 建 Experiment → **22:41:54 首次执行失败**（引擎按 `runIdentified` 纪律**正确**落 Run `FAILED` + `errorCode=INTERNAL_ERROR`）→ 用户重试 **22:43:29**（Run → `RUNNING`，进入数据集装配）→ **22:48:38 dev server 热重启**（实测 PID 27232 `CreationDate=22:48:38`，命令行 `tsx … server/_core/index.ts`）⇒ **在途 Run 被杀、永久停在 `RUNNING`**；因 `run()` 要求 `PENDING|FAILED|CANCELLED`、`runIncremental` 要求非 `RUNNING` ⇒ **该实验被完全锁死**（UI 恒显执行中）。**二、🔴 真实缺陷（已修）**：`engine.ts` 的 **`RUNNING` 转换不清上一轮失败残留** —— patch 只写 `status/startedAt/inputSnapshot/executionLog`，未清 `errorCode/errorMessage/completedAt`；后果 ① 重试后 `RUNNING` 的 Run 仍带旧 `errorCode`（UI 同时显示「执行中 + 上一次的错误」）；② `completedAt(22:41:54) < startedAt(22:43:29)`，**破坏「`startedAt` 空/非空 + `completedAt`」区分「预检拒绝 / 执行中崩溃 / 已收口」的既有语义**。修复：`run()`（约 L248）与 `runIncremental()`（约 L503）两处 patch 均补 `completedAt: null, errorCode: null, errorMessage: null`（仓储 `runs.update` 为 `patch.X === undefined ? {} : {X}` ⇒ 传 `null` 真写 NULL，已实测）。**回归**：`engine.test.ts` 15 → **16 例**、`engineIncremental.test.ts` 14 → **15 例**（均以「捕获 `RUNNING` patch」断言三字段为 `null`；无此修复时字段为 `undefined`，断言必失败 ⇒ 测试有效）。**三、已执行的修复动作**（一次性脚本，跑完即删）：Run 330003 → `FAILED`（errorMessage 注明「被热重启中断，请重新运行」）+ Experiment 240002 → `FAILED` ⇒ **用户可重新点「运行引擎」**；并清掉本次 E2E 残留 **Experiment 240001**（走产品级 `deleteExperimentCascade` leaf-first：1 实验 / 1 Run / 5 分析 / 1 假设 / **138 结果行** / 2 条件 / 1 结论）。终态核对：`research_experiment` 仅剩 **240002**(FAILED) 与用户既有 **180001**(COMPLETED，4 Run) ⇒ **用户数据零损失**。**四、验收**：`npx tsc --noEmit` **exit 0**；研究层聚焦（`server/researchEngine` + `server/researchCore` + `researchEngineRouter.test.ts`）**17 文件 / 286 例全过**。**五、⚠️ 两条运行纪律（本轮踩坑，已写入 `.workbuddy/memory/MEMORY.md`）**：① 🔴 **`npm run dev` = `tsx watch server/_core/index.ts`** ⇒ **改任何 `server/**` 文件都会热重启并杀死在途研究 Run**（v2 单次装配 ≈ **9 分钟**，极易撞上）；**用户在用页面时禁改 server 文件、禁跑重型真实库脚本**（`verifyResearchEngine.mts --all` 在 v2 上 ~9 分钟且抢占跨境 TiDB —— 本轮 22:41:54 的首次失败正落在我那个 E2E 的窗口 22:31→22:45 内）。② 被热重启杀死的 Run **无产品级恢复入口** ⇒ 只能人工收敛。**六、顺带取得真实证据**：那次 `--all` E2E 在 **v2/390002** 上 **5 类分析全部 COMPLETED**（QUANTILE 3261 / DESCRIPTIVE 2681 / EVENT_STUDY 1955 / CONDITIONAL 1969 / STABILITY 2005 ms）、Run/Experiment `COMPLETED`、结论 `SUPPORTED`（Q10−Q1 = −0.0475、t = −10.5747、n = 23748），**dataset 装配 529,740 ms 为绝对瓶颈**（分析合计仅 11,871 ms）⇒ **v2 单次整轮 ≈ 9 分钟**。**七、下一步（待决策，见 §44.5 队列 9h）**：为研究 Run 补「启动时回收孤儿 `RUNNING`」钩子，与既有 `reclaimOrphanBuildJobs()`（`server/_core/index.ts` 在 `server.listen` 后调用，DATASET-LIFECYCLE-001 已落地）同构 —— dataset 构建侧已有兜底，研究 Run 侧尚无。

- **2026-09-12 15:30 GMT+8 — WORK RESEARCH-004 分段关系分析（两窗）交付：变量层分段族 + `SEGMENT_RELATION` 分析类型 + 重叠守卫 + 新建分析页减负（`tsc` / `vite build` 双绿；零迁移、零 `ds_*` 改动、零 dataset 页面改动）**。用户原话：「研究实验的新建分析功能，比如说我想研究从 t 日到未来五日的最大回撤与从未来五日到更久的关系，现在好像不支持，有没有方案。而且现在新建分析的页面过于复杂，有很多我没懂。」用户两项拍板：能力 = **A（变量层）+ B（新分析类型）一起做**；页面 = **简化与能力一起做**。

  **一、诊断（先证明「不是数据缺，是变量层缺」，全部有坐标）**
  - 🔴 **变量层单锚点**：`server/researchEngine/variables.ts` 的 95 个结果变量**全部锚定 T 日收盘**（`close(rd)/close(0) − 1`）⇒「T+5 → T+20 这一段」**无法表达**。数据本身不缺：v2(390002) 的 `ds_first_limit_pullback_path` 实测 **471,816 行**、`relativeDay` 1..20 逐日 close/high/low 齐备。
  - 🔴 **`max_drawdown_5d` 的真实口径** = `min(close[T+1..T+5]) / close(T) − 1`（相对 **T 收盘**的最大跌幅，**不是峰谷回撤**）—— `datasetRegistry/path.ts#buildOutcomeRow` 的 `maxDrawdown: extremeRatioTo(closes, ref.eventClose, min)`。
  - **三条现成路径都走不通**：① QUANTILE 的 `featureField` 走 `catalog.resolveFeature` ⇒ 拿 `max_drawdown_5d` 当分组键必抛 `VARIABLE_ROLE_VIOLATION`（它确实不是 T 日可观测的量）；② CONDITIONAL 只能表达「满足/不满足」且只输出两组，做不出「窗 A 分档 → 窗 B 逐档统计」；③ 用 `future_return_20d` 当结果窗时其窗口 **[T+1, T+20] 包含**分组窗 [T+1, T+5] ⇒ 共享 K 线，结论有一部分是**同义反复**。
  - **全链路无重叠守卫**（grep `researchEngine/` + `client/`：仅 `conditional.ts` 的 summary 里一句泛泛 notes）。
  - **页面复杂度 3 条根因**（均可在代码指认）：① 暴露内部概念（`primaryPriority`「主分析优先级 N」徽标 = 结论生成器 `PRIMARY_PRIORITY` 的内部规则；底栏 `IMPLEMENTED_ANALYSIS_TYPES.join(" / ")`）；② 字段无分层（`analysisFormRequirements` 只决定「显不显示」，**无基础/高级分级** ⇒ 275 行的 `ConditionGroupsEditor` 在 5 个类型里 `canHaveConditions` 恒 true 全部同屏出现）；③ 两入口概念重叠（`CreateAnalysisDialog` 464 行 + `BatchAnalysisDialog` 884 行/3 Tab 并存）。

  **二、A —— 变量层：分段（两窗）结果变量族**（`server/researchEngine/variables.ts`，约 150 行）
  - 命名唯一规则：`segment_{stat}_{a}_{b}d`（`SEGMENT_STAT_KINDS` = `return` / `max_return` / `min_return` / `max_drawdown`；口径清单从 `researchCore/config.ts` 拼出，**不抄第二份字面量**）。锚点 = **窗起点** `close(a)`、取值窗 `[a+1, b]`，与 Dataset 的 `*_{h}d` 平行但**不同源、不可混称**（每个变量的 `definition` 把基准写清）。
  - 🔴 **`from = 0` 复用既有变量族**：`windowOutcomeVariableName(stat, 0, to)` → `future_return_{to}d`（path 族 1..20）/ `max_return|min_return|max_drawdown_{to}d`（outcome 族 {5,10,20}）⇒「T→T+5 的最大回撤」= Dataset 已定的 `max_drawdown_5d`，**不造一个「看起来一样、算出来略有差别」的第二套口径**。
  - **按需构造、不进目录**：`listOutcomes()` **不含**分段变量（190 窗 × 4 口径 ≈ 760 个名字，枚举会让目录膨胀约 8 倍）；`hasOutcome` / `resolveOutcome` 认得它们，`resolveOutcome` 用 `segmentWindowUsable(from,to)`（该 Dataset 的真实 path 视界包围盒）判可用性，越界抛 `UNKNOWN_VARIABLE`（具名带 `segmentRange`），**不静默返回 null**。
  - **缺失即 null**：扫窗口径（max_return / min_return / max_drawdown）**缺任一天整段返回 null**（不跳过缺失日按剩余日算 —— 那会让口径随缺失悄悄漂移）；锚点日缺失则整段不可用。
  - 新增 `segmentWindows.ts`（**唯一**把「已解析配置」翻成「真实变量名」的地方：`requiredVariables` 声明装载、`execute` 取值、结果 metadata 记名三处共用同一实现 ⇒ 杜绝「声明装的是 A、实际读的是 B」的静默错配）；**缺窗返回 `null` 由调用方具名失败，不替用户猜窗**。

  **三、B —— `SEGMENT_RELATION` 分析类型**（`analysisConfig.ts` 校验 + `analyses/segmentRelation.ts` 执行器 + `metrics.ts` 配对层）
  - **配置契约**：`researchCore/types.ts` 的 `RESEARCH_ANALYSIS_TYPES` 末尾加 `SEGMENT_RELATION`（**12 个类型**）；`researchCore/config.ts` 加 `windowA` / `windowB` / `windowAStat` / `windowBStat` / `windowBands` + `SEGMENT_STAT_KINDS` + `DEFAULT_WINDOW_BANDS = 5`；`resolveAnalysisConfig` 透传窗参数（**窗不给默认值**，缺窗由校验报错）。
  - **4 项校验**（`analysisConfig.ts#resolveSegmentWindows`，任何一项不过即具名失败、绝不夹取或换一个「差不多」的窗）：① 窗形态（二元整数、`0 ≤ from < to`）；② 口径在 `SEGMENT_STAT_KINDS` 内；③ **可用性** —— 映射出的变量名必须真的在该 Dataset 目录里（`from = 0` 走既有族、`from > 0` 走分段族）；④ 🔴 **重叠守卫** `[a+1,b] ∩ [c+1,d] ≠ ∅` → `WINDOW_OVERLAP`（错误码独立于 `INVALID_ANALYSIS_CONFIG`，并已接 `researchEngineRouter#toTrpcError` → `BAD_REQUEST`）；另加 `windowBands ∈ [2,100]`。
  - **执行器**（`analyses/segmentRelation.ts`，约 290 行；注册进 `analyses/registry.ts`）：配对（两侧同时有限，**不插补**）→ 复用 `computeCutPoints` / `assignQuantileGroups` 分档 → 逐档 4~5 个指标（`SAMPLE_COUNT` / `MEAN_RETURN` / `MEDIAN_RETURN` / `STD_RETURN`，窗 B 非跌幅口径时加 `WIN_RATE`）→ 配对度量 3 个标量 → `SPREAD_TOP_BOTTOM` / `T_STAT_DIFFERENCE` / `P_VALUE_DIFFERENCE`；`monotonicConsistency` 由 `quantile.ts` 私有改 export 供**共用同一实现**。**重叠守卫执行器再断言一次**（结论可解释性的前提不能只靠上游一处把关）。`conclusion.ts#PRIMARY_PRIORITY` 末尾加 `SEGMENT_RELATION`。
  - **配对层**（`metrics.ts`）：新增 `PairedMetricComputation` + `alignedPairs`（同下标且两侧都有限的**唯一配对口径**，长度不等直接抛错）+ `PAIRED_METRIC_COMPUTATIONS`（`PAIR_CORRELATION` / `PAIR_RANK_CORRELATION` / `PAIR_SAMPLE_COUNT`）+ `listPairedMetricCodes`；`MetricCalculator` 加 `computePaired()`，`definitionOf` / `labelOf` 覆盖三层；底层**全部复用 `shared/quant-stats.ts`**（`pearsonCorrelation` / `spearmanCorrelation` 已存在，**无需新增统计实现**）。`researchCore/results.ts#RESEARCH_METRIC_CODES` 同步登记 3 码。
  - **诚实边界（写进 `summary.notes` 与变量 definition）**：分段量是 **OUTCOME**（最早在窗起点收盘可观测）⇒ **不是 T 日可交易信号**；`T_STAT_DIFFERENCE` / `P_VALUE_DIFFERENCE` 为 Welch 两样本（正态近似 p）、配对相关系数**均未校正多重比较**，且事件样本本身存在重叠视界 ⇒ 独立性假设不严格成立；交易有效性必须经 Backtest / 稳健性 / OOS。

  **四、C —— 新建分析页减负（与研究能力同批做完）**
  - `AnalysisTypeOption` 拆 **`label`（短类型名，会进持久化的分析名 ⇒ 必须短、稳定）+ `question`（人话问题句，作选择题主标题）**—— 直接把人话问题写进 `label` 会让建议名变成「某个信号和未来收益有关系吗：turnover 分 10 组 → …」（护栏测试当场抓到）；`suggestAnalysisName` 用 `label`。
  - `CreateAnalysisDialog` 重写为 **① 你想回答什么问题（问题卡）/ ② 参数（只渲染必填）/ ③ 高级（默认收起，分析名称移入）**；移除「主分析优先级」徽标与底栏内部枚举；新增 `WindowEditor`（实时显示窗 → **真实变量名**，`from = 0` 打「复用既有口径」徽标，附 `可用范围 T+min..T+max`）。
  - `createAnalysisForm.ts`：`analysisFormRequirements` 加 `needsSegmentWindows`（所有 case 补齐）；新增 `SegmentWindowRange` / `segmentValueWindow` / `windowRangesOverlap` / `defaultSegmentWindows` / `parseRelativeDay` / `validateSegmentWindows`（4 项，**与后端同式**）/ `windowVariableName` / `usesExistingVariableFamily` / `windowDescription` / `segmentRelationDescription`；前端**只镜像类型、不 import 服务端常量**（防 bundle 泄漏，用 `satisfies` 保证不漂移）；`segmentRange` 取自真实 `listVariables.datasetVersion.pathRelativeDayRange`（已核实后端确实返回该字段）。
  - **批量矩阵新增 `MATRIX_ANALYSIS_TYPES`**：SEGMENT_RELATION **不在其中**（两个窗就是选题本身，一套窗参数铺开 N 项只会产出 N 个相同配置 —— 那不是批量、是复制）；若被传入，`expandAnalysisMatrix` 记一条 `skipped` 说明，**不静默少建**；`BatchAnalysisDialog` 的类型多选改为按该常量过滤（唯一权威，不手写白名单）；入口按钮 `批量新建` → `批量 / 模板`。
  - ⚠️ **未做（如实记录）**：两个入口（单建 / 批量）**只改了文案与清单来源，未真正合并为同弹窗 Tab**（合并需新增前端 wrapper，且要避免动 `MAX_BATCH_ITEMS` 所在文件的连线）；页面复杂度根因 ③ 仍在，留作后续。

  **五、验收证据**
  - `npx tsc --noEmit` **exit 0**；`npx vite build` **RC=0**（15.9 s；最大 chunk 2,236.92 kB 的既有告警与技术债不变）。
  - 聚焦：**25 文件 / 470 例全过**（`npx vitest run server/researchCore server/researchEngine client/src/components/research client/src/adapters/researchEngineAdapter.test.ts`）。新增 **`server/researchEngine/analysisConfig.test.ts` 13 例**（缺窗 / 畸形窗 / 非整数 / `to ≤ from` / 越界 / 口径非法 / `windowBands` 边界 / **三组 `WINDOW_OVERLAP`** / 紧邻窗不算重叠 / 消息含两个取值区间与建议写法）；扩测：`variables.test.ts`（分段族 7 例：解析 / 命名 / 取值区间 / 目录可用性 / `from=0` 复用 / 四种口径值 / 缺天即 null）、`metrics.test.ts`（配对 4 例）、`analyses.test.ts`（`SEGMENT_RELATION` 7 例：变量需求、缺窗不兜底、分档+配对+顶底档差、缺失不插补、跌幅口径不产 `WIN_RATE`、执行器再断言重叠、单档不产档差）、`createAnalysisForm.test.ts`（分段窗 7 例：前后端镜像对齐 / 默认窗 / 相对日解析 / 4 项校验 / 分档数 / payload / 描述文案）。
  - **护栏断言更新（预期变更，非削弱）**：「恰好 5 类」的 4 处断言同步到 6 类 —— `researchCore/types.test.ts`（11 → 12 种）、`batchCreate.test.ts`、`analyses.test.ts#Registry 派发`、`createAnalysisForm.test.ts`；并新增一条「`label` 必须是短名、不得含问号」的断言，把「名字进持久化」这条纪律固化下来。
  - 全量：**214 文件 / 3252 例，15 失败 / 7 文件** —— 失败集合与既有基线**逐项一致**（`image.uploadAndRecognize` / `dataHealth`(FE-1) / `limitUp`(sector) / `limitUp.watch`×4 / `marketData`×4 / `tushare.secret` / `tushareTradingCalendar`×3，均为环境依赖：真实 DB 直连 / 外部 API / 5s 超时）⇒ **零新增失败**。证据日志 `_seg_full.log`。
  - **零数据依赖声明**：**未新增 migration**（`analysisType` 为 `varchar(32)`，无 ENUM/CHECK，`SEGMENT_RELATION` 16 字符直接落库，已核 `drizzle/0031_research_core.sql:105` 与 `drizzle/schema.ts:1347`）；**未改任何涨停判定 / Dataset 构建 / 分析结果口径**；**未触碰 `ds_*` 与 dataset 页面**。

  **六、顺带自查纠错（不改代码行为，只改表述）**
  - 🔴 原注释与提示语「窗 B 口径为 `max_drawdown` 时**恒为非正**／该值必然接近 0」是**错的**：取值窗 `[a+1, b]` **不含锚点日** `a`，价格整段上行时窗内最低收盘仍可能**高于**锚点收盘（实测合成数据即正）。已改正为「『取值 > 0 的占比』不构成通常意义上的胜率」，并把「并非恒为负」的原委写进 note。
  - 顺带修掉 `analysisBatchForm.ts#syntheticState` 用手写字面量构造表单状态的做法（本轮表单加 7 个窗字段即被 tsc 抓出漏字段）⇒ 改为 `...createDefaultAnalysisForm(params.analysisType)` 起步，默认值只有一处权威。

- **2026-09-12 15:35 GMT+8 — 待办登记：研究 Run 侧仍缺「启动时回收孤儿 `RUNNING`」钩子（对应 §44.5 第 9h 条）**。本轮实查确认该缺口**仍存在且已产生真实卡死实例**：`research_run.id=330003`（`experimentId=240002`）当前 `status=RUNNING`、`completedAt=null`、`errorCode=null`、`sampleCount=null`，`executionLogJson` 里**两条 FULL 批次均停 `RUNNING`**（第 1 批 `startedAt=2026-09-11T14:43:29Z`、第 2 批 `2026-09-11T14:58:22Z`，即 CST 22:43 / 22:58 —— 与 2026-09-11 22:55 记录的「22:48:38 dev 热重启杀死在途 Run」时间线吻合；第 2 批亦为同因中断属**推断**，未取进程证据）。⇒ **该 Run 自 2026-09-11 22:58 起已停更约 16.6 小时**，而 `run()` 要求 `PENDING|FAILED|CANCELLED`、`runIncremental` 要求非 `RUNNING` ⇒ 该实验在 UI 上恒显「执行中」，**无产品级恢复入口**。同构参照已存在：dataset 构建侧 `reclaimOrphanBuildJobs()` 由 `server/_core/index.ts` 在 `server.listen` 后调用（判据 = `RUNNING` 且 `updatedAt` 停更超阈值，默认 10 分钟）。**本轮只做登记、不改代码**（用户本轮诉求是研究能力与页面，不夹带运行态改造；且判据需先决策：boot 时任何 `RUNNING` 即孤儿 vs 复用停更阈值，并须同时决定是否确立单实例假设）；补上后须一并写 `errorCode`（如 `RUN_ORPHANED`）+ `errorMessage` + `completedAt`，并把 Experiment 置 `FAILED`。

- **2026-09-12 15:35 GMT+8 — WORK PERF-IMPL-001 研究装配提速落地（方案 A：压缩协议 + 列裁剪 + 有界流水并发；口径零变更）**。

  **触发与决策**：用户「这个项目中的分析研究过于慢，想办法加快一下，应该是数据过于多从而太慢了」→ 只读诊断（`docs/PERF-DIAG-001_research_assembly.md`）确认 **98% 耗时在数据集装配（529.7s）而非分析（11.9s）**，且 **RTT×往返仅占 ~2% ⇒ 不是延迟受限而是吞吐受限**，成本模型 `耗时 ≈ 行数 × 单行成本 ÷ 并发度` 只有三个杠杆。用户拍板：**「按方案 A，允许提升，不设上限，合理即可」**（不做方案 B 本地快照/镜像）。

  **一、交付（7 改 2 新增 2 测试 1 工具）**
  - `server/db.ts`：连接池新增 `compress`（新 `resolveCompress()`，`DB_COMPRESS=0` 可关、默认开）；`resolvePoolSize()` 默认 **10 → 16**（依据：吞吐在 ~6 并发语句后进入平台期；装配稳态 ≤9 条在飞，留余量给常规查询；上限仍 64）。
  - **新增 `server/researchEngine/columnProjection.ts`**：列裁剪**从变量定义自动派生**（「记录访问」代理跑一遍 `resolve`，**读取即声明**）+ `guardProjectedRow` 越界守卫 + `ProjectionGuardMode`（`off|first-chunk|all`，默认 `first-chunk`）。
  - `server/datasetRegistry/query.ts`：导出 `DATASET_{EVENT,PREFIX,PATH,OUTCOME}_COLUMNS`（由 `getTableColumns()` 派生，**不手抄**）；`buildColumnSelection()`；事件/prefix/path/outcome 的**分页读与批量读共 7 个方法**支持可选 `columns`。
  - `server/researchEngine/datasetReader.ts`：4 类查询透传 `columns`；4 类读取 + `getVersionContext` 全部接 `withReadRetry`。
  - `server/researchEngine/sampleSet.ts`：由「取一批→等→装配→取下一批」改**有界流水并发**（`produce()` 串行推进事件 keyset 链并把「数据仍在飞」的批次放入有界缓冲，消费端严格按 `shift()` 顺序装配）；默认深度 **3**（env `RESEARCH_ASSEMBLY_CONCURRENCY`，上限 16）。
  - **新增 `server/researchEngine/readRetry.ts`**：跨境**只读**的有界瞬时错误重试（默认 3 次尝试、300→900ms 退避、**沿 `cause` 链判定**、每次重试打告警、**明确不用于写路径**）。
  - `server/researchEngine/types.ts`：新增错误码 `PROJECTION_MISSING_COLUMN`。
  - **新增** `columnProjection.test.ts`（13 例）、`readRetry.test.ts`（8 例）、`scripts/perfResearchAssembly.mts`（只读基准）。

  **二、受控 A/B 实测（同一时间窗；v2=390002；3 批 = 270,000 行；全变量目录）**
  | 配置 | 耗时 | 吞吐 | 累计 |
  |---|---|---|---|
  | `raw/不裁剪/conc=1`（**生产现状**） | 267,478ms | 1,009 行/s | 1.00× |
  | `compress/不裁剪/conc=1` | 73,494ms | 3,674 | **3.64×**（压缩） |
  | `compress/裁剪/conc=1` | 63,586ms | 4,246 | **4.21×**（裁剪 +1.16×） |
  | `compress/裁剪/conc=3` | **15,563ms** | 17,349 | **17.18×**（流水线 +4.09×） |
  | `compress/裁剪/conc=6` | 15,486ms | 17,435 | 17.27×（**与 3 无显著差异 ⇒ 默认取 3**） |

  **全量**：`compress/裁剪/conc=3` **71,989ms**（1,071,266 行）；不裁剪对照 107,838ms ⇒ **裁剪在全量下 1.50×**。
  **验收场景（turnover → future_return_5d，47,835 行）**：`raw/不裁剪/conc=1` **95,961ms** → `compress/裁剪/conc=3` **8,093ms** = **11.86×**。

  **两类场景主导杠杆不同（这是本轮最有价值的发现）**：全变量目录每批 ~90,000 行 ⇒ **吞吐受限，压缩主导**（3.64×）；验收场景每批 ~4,000 行、4 条小查询 ⇒ **延迟受限，流水线主导**。三项都做才同时覆盖两类研究。

  ⚠️ **裁剪实测低于诊断期估计**：诊断期单查 prefix 得 3.27×，混合装配里只有 1.16~1.50×（每批三条并发，prefix 收益被 path 稀释；且 path 的 `IN(2000 eventId) × relativeDay IN(20)` 时间主要花在 TiDB 执行侧索引寻址而非传输字节）。**已用全量对照独立复核，非估算** —— 属对诊断期数字的**向下修正**。
  ⚠️ **跨日绝对数字不可比**：历史 529.7s 采集于链路明显更快的时段（隐含 2,040 行/s，今日「不裁剪不压缩」基线仅 1,009 行/s）⇒ **可靠结论是同一时间窗内的比值**，不得写成「529s → 8s」。

  **三、正确性（列裁剪「不可能静默变 null」的三道防线）**
  1. **自动派生**：派生用「记录访问代理」跑 `resolve`，读过哪些列就取哪些列 ⇒ 变量定义改动后投影自动跟随，**不可能与真实读取漂移**（不要求任何变量手写裁剪清单）；
  2. **越界即失败**：真实数据上把「读了未投影的列」变成 `PROJECTION_MISSING_COLUMN`，捕获「只在特定取值下才走到的隐藏分支」；
  3. **差分测试**：逐变量比对「全列取值 vs 投影后取值」必须逐位相等 + 端到端比对 `columnProjection:"all"` 与自动派生装配的 `samples` `toEqual` + 并发 1 vs 4 批序/结果一致。
  派生结果（全变量目录）：`prefix` **13 → 5 列**（只留 `close/volume` + 结构列）、`path` **15 → 7 列**、`outcome` **10 → 8 列**、`event` **18 → 12 列**。

  **四、验收**
  - **真实端到端 `scripts/verifyResearchEngine.mts --version=390002 --all` ✅ 通过**：`sampleCount=23,978`（v2 全事件）；**Dataset 装配 8,925ms**（与基准脚本同需求的 8,093ms 互证，差 <10%）；5 类分析合计 8,989ms；引擎总计 25,355ms。**关键**：脚本 `[8b] 独立复核`**脱离引擎直接读物理表复算**得全样本 n=23,748、首尾差 **−0.047546**，与引擎 QUANTILE 的 −0.0475 **完全一致 ⇒ 裁剪未改变任何取值**。验收数据 9 行已级联清理（零残留）。
  - `npx tsc --noEmit` **exit 0**；`vitest run` **3,206 例中 3,191 过**。15 个失败**全部为既有环境性失败**（vitest 未加载 `.env` 的 DB 依赖用例 + `tushare.secret` 缺 token + `tushareTradingCalendar` 超时）；**已用 `DB_COMPRESS=0` 复跑对照，失败完全一致 ⇒ 与本轮改动无关**（本轮不触及这些模块）。

  **五、顺带补掉的真实 robustness 缺口**
  - **偶发 `ECONNRESET`**：基准 14 次运行出现 **1 次**（发生在一条 40,000 行的 path 查询上）。装配是「12 批 × 3 条大查询 = 36 次往返」的长任务 ⇒ **一次瞬时重置让整轮装配作废**，代价与「慢」等价。已加 `readRetry.ts`（只读、只重试瞬时错误、有界、可见）。

  **六、口径与副作用声明**
  - **未新增 migration、未改任何表结构、未改任何过滤条件 / 行数 / 变量定义 / 统计口径、未写库、未删任何数据、未建任何副本表**；`compress` 为**池级开关**（对全站大型读取一并生效，实测对小查询无副作用：COUNT 1.00×、小分页 1.30× 更快）；`DB_POOL_SIZE` 仅**默认值**变化（环境变量可覆盖，未改代码语义）。
  - **未做**：方案 B（本地快照/镜像，用户未选）；组合回测（305~413s）与 `getLeaderCandidates()`（28.8s）未单独优化 —— 但**压缩是池级开关，其 152 万行价格行跨境传输按本次压缩档 ~3.6× 估算有望由 ≈196s 降至 ≈55s（推断，未实测）**；`path` 查询执行侧成本未优化（如需再进一步，方向是 SQL 侧聚合下推，口径风险高）。
  - 基准产物 `_perf*.jsonl` / `_perf*.log` / `_test_full.log` / `_e2e.log` 跑完即删；`docs/PERF-IMPL-001_research_assembly.md` 为本轮固化报告。

- **2026-09-12 15:40 GMT+8 — 人工收敛孤儿 Run（`RUN_ORPHANED`）+ 用户当场首次实跑通 RESEARCH-004 全链路 + 独立复核逐位吻合**。用户指令：「标为fail」（指 §47 15:35 条登记的 `research_run.id=330003`）。

  **一、收敛动作（一次性脚本 `_oneoff_failrun.mjs`，跑完即删；预演后加 `--apply`）**
  - `research_run 330003`：`RUNNING` → **`FAILED`**，`errorCode='RUN_ORPHANED'`，`errorMessage` 如实写明「执行器在 2026-09-11 22:58:22（CST）被进程重启中断，进程消亡后无任何东西再推进该 Run」。
  - **`completedAt` 取其 `executionLogJson` 内最大时间戳（`2026-09-11T14:58:22.055Z`）而非 `NOW()`** —— 该 Run 真实死于那一刻，用 `NOW()` 会把「停更 16.6 小时」伪装成「刚刚结束」。`sampleCount` 保持 `null`（从未产出，不臆造）。
  - `executionLogJson` 的两个悬挂 `RUNNING` 批次**就地收敛为 `FAILED`**（`settleExecutionLogEntry` 口径：不新增条目、不留悬挂态；`nextExecutionSequence` 因此为 batch 3，如实承认历史）。
  - `research_experiment 240002`：`RUNNING` → `FAILED`（对齐 `engine.ts:384` 的失败收敛口径；引擎本身不写 Experiment `completedAt`，故本轮也不写）。

  **二、🔴 时区口径实查（新发现，写入 memory）**：库中时间戳存的是 **UTC 墙钟**。证据：`DATE_FORMAT(createdAt,...)` 原始值 `research_run 330003 = 2026-09-11 14:40:28`，与 §47 22:55 条记录的「22:40:21 建 Experiment」仅差 7 秒 ⇒ 即 UTC（+8 = CST 22:40）。而**本机 Node 进程 TZ = `Asia/Shanghai`** ⇒ 临时脚本若用 mysql2 默认 `timezone:'local'`，读任何时间戳都**整体差 8 小时**（`330003.startedAt` 读成 `06:58:22Z`，其真实值为 `14:58:22Z`）。**规避：写库时间戳一律传字符串字面量、不传 `Date` 对象**（本轮做法）。

  **三、⚠️ 竞态如实记录**：用户在我执行 UPDATE 的同时（15:36:45）**新建并启动了 Run 390001** ⇒ 我的 `UPDATE research_experiment SET status='FAILED' WHERE status='RUNNING'` 落在引擎（`engine.ts:272`）已把 Experiment 置 `RUNNING` **之后**，短暂把「执行中」覆盖成 `FAILED`；引擎收尾（`engine.ts:336`）随即写回 `COMPLETED` ⇒ **自愈、零残留**（已实测确认终态为 `COMPLETED` / `sampleCount=23978`）。**教训**：运维脚本的状态写入必须带「仅在该状态才写」的前置条件（本轮已带），且**并发执行期间不要写 Experiment/Run 状态**。

  **四、✅ 用户当场首次实跑通 RESEARCH-004 全链路**：Run 390001（`runNo=2`）下 1 个 `SEGMENT_RELATION` 分析（`analysisId=330001`，名「T（事件日收盘）..T+5 最大跌幅 → T+5..T+20 分段收益」，`configJson = {windowA:[0,5],windowB:[5,20],windowAStat:"max_drawdown",windowBStat:"return",windowBands:5}`）→ **`COMPLETED`**，`sampleCount=23978`（v2 全事件），**耗时 42s**（`07:36:45→07:37:27` UTC = 15:36:45→15:37:27 CST），产出 **31 行 `research_result`**；自动结论 `SUPPORTED`（confidence 0.95，R2~R5 四条规则全过）。⇒ RESEARCH-004 的「零迁移落库 → 跑通 → 出结论」在**真实数据上闭环**。

  **五、实测结果（窗 A = `[T+1,T+5]` 最大跌幅，窗 B = `[T+6,T+20]` 收益；band 1 = 窗 A 取值最小 = 跌幅最深）**

  | band | 窗A 均值（跌幅） | 窗B 均值 | 窗B 胜率 | 窗B 标准差 | n |
  |---|---|---|---|---|---|
  | 1（最深） | −14.43% | **+0.19%** | 45.28% | 17.02% | 4589 |
  | 2 | −6.86% | **+0.42%** | 45.99% | 16.29% | 4590 |
  | 3 | −3.50% | −0.04% | 43.80% | 16.44% | 4587 |
  | 4 | −0.14% | −0.08% | 42.67% | 18.06% | 4589 |
  | 5（最强/未回踩） | **+6.48%** | **−1.61%** | **38.57%** | 20.80% | 4589 |

  配对：`PAIR_SAMPLE_COUNT=22944`、`PAIR_CORRELATION=−0.031734`、`PAIR_RANK_CORRELATION=−0.068209`；`SPREAD_TOP_BOTTOM=−0.018022`、`t=−4.542185`、`p=5.57e−6`、方向一致性 0.750；1034 个样本因窗 A 或窗 B 取值缺失被排除（**不插补**）。**读法**：相关极弱；「T+5 后表现差」的那一档是**窗 A 最强/根本没回踩**的（均值 +6.5%），其窗 B 均值 −1.61%、胜率仅 38.6% 且波动最大 ⇒ 与「首板回踩后才有反弹」的直觉一致，但**非严格单调**（band 2 的均值与中位数均优于 band 1，最深的 band 1 已近破位）。

  **六、独立复核（脱离引擎，直接用 `ds_first_limit_pullback_path` 复算；`NTILE(5) OVER (ORDER BY va)`）**
  - 逐档 `AVG(vb)` 与 `win_rate` 与引擎输出**一致到 4~5 位**（band1 +0.1942%/45.28%、band2 +0.4183%/46.00%、band4 −0.0762%/42.67%、band5 −1.6069%/38.58%）；band 3 因分档边界并列值的 tie-break 不同有 4 位后差异（−0.0412% vs 引擎 −0.0383%），非口径分歧。
  - **手工皮尔逊 = −0.031734，与引擎 `PAIR_CORRELATION` 完全一致到 6 位小数**；配对数 22944 一致。
  - 窗 A 取值分布：`min=−0.6463`、`max=+0.1200`、**取值为正的占比 28.54%** ⇒ **实证了 §44.5 9i 里那处自查纠错**：`max_drawdown` 分段口径**并非恒为负**（该口径 = `min(close[T+1..T+h]) / close(T) − 1`，整段在锚点收盘之上时为正）。

  **七、遗留 / 未做**：§44.5 第 9h 条（boot 回收孤儿 `RUNNING` 钩子）**仍未开工**，且已第二次产生真实卡死实例（见 9h 条尾注）；`research_analysis_metric` 对本分析 0 行（配对指标落 `research_result`，未深究，疑为该表用途与预期不同 ⇒ 待查）；本轮的 `_oneoff_*.mjs` 5 个临时脚本**已全部删除**。

- **2026-09-12 16:05 GMT+8 — WORK RESEARCH-005 研究能力 + 页面可读性：事件日形态变量 + 「最低价守护族」+ 逐日量比 + 内置示例 + 结果页去噪（`tsc` / `vite build` 双绿；零迁移、零 `ds_*` 改动、零 dataset 页面改动）**。用户原话：「新建分析页面还是很乱，我需要你给我一些例子，并把结果页面展示的更简洁明了。比如我想研究首板涨停，并且不是一字板后，未来五日内回撤不破涨停日最低价，对应未来二十日内的收益。而且需要回撤的这几天每天的成交量的关系。」用户 4 项口径拍板：**破位口径 = 盘中 `low` 与收盘 `close` 都产出**；**非一字板 = 开盘未涨停与盘中未开板都产出**；**量能 = 逐日量比**；**量能范围 = 全部 T+1..T+5**。
  - **诊断（三条，其中一条纠正了用户预期）**：① **「首板」不用配** —— Dataset 构建的事件规格写死为 `{ relativeDay: 0, kind: "firstBoard" }`（`server/datasetRegistry/filter.ts:29`），该数据集里每条事件本身就是首板；② **数据全在、缺的是变量**：「非一字板」要 `prefix(rd=0)` 的 open/low、「不破涨停日最低价」要 `path` 极值 vs 事件日 `low(0)`、「逐日量能」要 `path.volumeRatio`（实测口径 = `volume(rd)/volume(0)`，零争议）—— 三者**物理列全部存在**，变量层一个都没有；③ 🔴 **结构性障碍**：结果侧数据源 `OutcomeSources` 原本**只有 path + outcome**，**拿不到事件日 `low(0)`** ⇒ 不是「加个变量定义」就行，必须先打通数据通路。
  - **A —— 变量层**（`server/researchEngine/variables.ts`）：① 新增 4 个**特征**：`event_low_offset`（= `low(0)/close(0) − 1`，守护基准线）、`event_open_offset`、`is_one_word_open`（开盘即涨停 0/1）、`is_one_word_hold`（全天未开板 0/1）—— 判定用**绝对容差** `PRICE_EPS = 1e-6` 元（涨停价已四舍五入到分，1e-6 远小于最小变动 0.01 元；**刻意不用相对容差**，因价格量级横跨 1~1000 元、相对阈值会随价格漂移）；② **`OutcomeSources` 增 `eventBar`（必填、值可为 `undefined`）+ `OutcomeVariableDefinition.needsEventBar`** —— 结果变量读 T 日**不碰 PIT 防线**（防线管的是「特征偷看未来」，此处是「结果回看 T 日基准」，且 `*FromEventClose` 一族本就以 `close(0)` 为分母）；③ 新增**事件日最低价守护族**（4 口径 × outcomeHorizons `{5,10,20}` = 12 个）：`holds_event_low_{h}d` / `holds_event_low_close_{h}d`（0/1，「1 = 未破」便于条件写成 `= 1`）+ `event_low_margin_{h}d` / `event_low_margin_close_{h}d`（连续，`min(极值)/low(T) − 1`，> 0 = 未破）；视界取 **outcome 而非 path**，两条理由：语义上与 `max_drawdown_{h}d` 同属 outcome 口径；成本上 `min` 需 path 的 1..h **每一行**（h 取满 20 会让每事件多搬 20 行，而研究上无此需求）；④ `volume_ratio_{h}d` 并入 **path 族**（`PATH_KIND_FIELD` 加 `volumeRatio`）⇒ 随 pathHorizons 展开，**视界跟随 path 而非 outcome**。
  - **B —— 装配层（两处注入，缺一即静默全 null）**：`sampleSet.ts` ① `outcomeDefs.some(needsEventBar)` ⇒ `prefixDays.add(0)`（否则 `eventBar` 恒 `undefined`）；② `outcomeSources` 注入 `eventBar: prefixMap.get(0)`。`columnProjection.ts` ③ **探针无条件提供 rd=0 的 `eventBar`** —— 这是最隐蔽的一环：列投影靠「跑一遍 `resolve` 记录读了哪些列」派生，若探针里 `eventBar` 为 `undefined`，`needsEventBar` 的 `resolve` 会提前 `return null` ⇒ **low/close 两列不被记录 ⇒ 投影把它们裁掉 ⇒ 真实数据上变量静默全 null**（不报错、不告警）；故探针缺 rd=0 时**补造一行**，不依赖调用方记得传。
  - **C —— 页面（用户本轮的另一半诉求）**：① **「从例子开始」6 个内置示例**（`ANALYSIS_EXAMPLES` / `applyAnalysisExample` / `missingVariablesForExample`，置于「新建分析」弹窗 ⓪ 区）—— 与既有「我的模板」（RESEARCH-002C，**需先有配好的分析才能存**）互补：内置示例要解决的正是「不知道该怎么配」这个**入口**问题；示例的 `requiredVariables` 只列关键变量，目录缺变量时**直接禁用该卡并写明缺什么**（而不是让人点完才被后端拒绝）；分段窗示例按**真实 path 视界钳制**（例子写 5..20，上界不足则钳到上界，再不行退回默认窗），避免「点了就报越界」。② **自查纠错（必须记录）**：示例初版把 `volume_ratio_3d` 当 QUANTILE 的 `featureField` ⇒ **PIT 违规**（量比 T+3 收盘才可观测，是**结果**不是特征）；已改为 CONDITIONAL 条件筛选（条件右值可为常量，合法）。③ **测试抓到一个真 bug**：`applyAnalysisExample` 初版把条件映射成**条目数组**，而 `CreateAnalysisFormState.conditions` 的类型是 `ConditionGroupDraft[]`（**组**）⇒ 组对象缺 `conditions` 字段，载荷构造器读到时崩；已改为包成一组（组内 AND）。④ **结果页去噪**（`AnalysisResultsView` 重写）：默认只显示 **6 类核心列**（样本数 / 均值 / 中位数 / 胜率 / 标准差 / 回撤），其余**折叠不删**（`显示全部指标（+N）`）；分组表顶部加**主指标速览**（最低档 / 最高档 / 顶底差）；`n=` 在分母一致时**只在分组标签处标一次**（原来逐格重复属纯噪音）；`metricCode` 不再占一列（改单元格 `title`）；底部长说明收进可折叠区。
  - **真实库验证（v2 / `390002`，只读）**：`ds_first_limit_pullback_prefix` 相对日 **−20..0**、rd=0 行 **23,978**（与事件数一致）、rd=0 的 open/low/volume **零 NULL** ⇒ 守护基准线完整可得；事件日形态分布 **开盘即封 1,219 / 23,978 = 5.08%**、**全天未开板 769 / 23,978 = 3.21%**（一字板确实稀少 ⇒「非一字板」筛选有实际区分度）；抽 3 个事件核对 `low(T)` / `close(T)` / `minLow(5)` / `minClose(5)` 与两种口径判定、余量计算全部正确。
  - **验收**：`npx tsc --noEmit` **exit 0**；`npx vite build` **RC=0**（24.96 s）；聚焦（`server/researchCore` + `server/researchEngine` + `client/src/components/research` + `client/src/adapters`）**28 文件 / 527 例全过**（新增 `variables.test.ts` 8 例 + `createAnalysisForm.test.ts` 8 例；同步更新 2 处**预期变更**断言：`columnProjection` 的「prefix 不该取 open/low」与「path 不该取 volumeRatio」因新变量读这些列而失效、`buildOutcomeVariables` 精确名单 +5 个）；**全量 216 文件 / 3399 例，17 失败 / 8 文件** —— 其中 **15 例 / 7 文件与既有基线逐项一致**（真实 DB 直连 / 外部 API / 5s 超时），**另 2 例（`strategyDomainPersistence.test.ts`）来自并行进行的 STRATEGY-003 会话**（其 `strategySchema/map.ts` 与测试文件 mtime = 09-12 16:01 / 16:02，且该测试对本轮改动模块的 `import` 引用计数为 **0**）⇒ **本轮零新增失败**。**零迁移**（未新增/修改任何 DDL：新变量全部由既有物理列派生）、**未触碰 `ds_*` 与 dataset 页面**。

- **2026-09-12 16:20 GMT+8 — WORK STRATEGY-003 Strategy Domain Model & Persistence Architecture（COMPLETE；`tsc` exit 0 + 真实 TiDB 全链 89/89 PASS）**。用户两轮指令：先「**先完整审计再实施**」（STEP 1–5 只读审计 → `docs/strategy/STRATEGY-003-difference-report.md`，含 §45 十三问、差异矩阵、F1–F10 发现、5 个被否决方案、D1–D3 待裁定），再正式裁定并授权实施 STEP 6–15。

  **一、用户三条裁定（全部落地）**：**D1** 在既有 `strategyDocumentJson` 内**演进**富模型，**不新建** `strategy_definitions` 等第二套 Source of Truth 表；**D2** **不改物理列名**（`strategyDocumentJson` / `fingerprint`），Domain 层做语义映射（登记于报告 §5.4）；**D3** **复用 C-21.1 八态**（Draft…Retired），**未新造** `DRAFT/RESEARCHING/ACTIVE/ARCHIVED`。

  **二、Migration（STEP 6）**：`drizzle/0034_strategy_domain_model.sql`（196 行 / 15 语句，`-- @guard:` 守卫式幂等 DDL —— MySQL/TiDB 对 `ADD COLUMN IF NOT EXISTS` 支持不一致，故脚本先查 `information_schema` 再执行）+ `scripts/applyStrategyDomainModel.mjs`（apply / `--dry-run` / `--check`）。`strategies` +`description`/`strategyType`/`currentVersionId`（**权威当前版本指针**，`latestVersion` 降级为兼容冗余列）；`strategy_versions` +`parentVersionId`/`status`(默认 `Draft`)/`description`/`updatedAt`；新建 **5 张单向派生投影表** `strategy_parameters`（UNIQUE version+code）/ `strategy_entry_rules`（UNIQUE version+ruleId）/ `strategy_exit_rules`（同）/ `strategy_execution_rules`（UNIQUE version，1:1）/ `strategy_version_datasets`（UNIQUE version+datasetId+version+role）。**实测幂等**：首次 `executed 15 / skipped 0`，复跑 `executed 0 / skipped 15`，7 表实查存在且 rowCounts 全 0（两表迁移前即 0 行 ⇒ §38 向后兼容自动满足）。**未用** `db:push` / `drizzle-kit generate`（journal/snapshot 自 0024 起停维护）。

  **三、Domain Model（STEP 7）**：`strategySchema/definition.ts`（635 行）为类型权威源 —— `StrategyDefinition{entry(event/observationWindow/trigger/conditions) / exit(rules[]) / position / risk / execution / parameters / datasets}`，全程 `readonly` + `deepFreeze`。**execution 强制分离 `signalTiming` vs `executionTiming`**（T_CLOSE 出信号 → T_PLUS_1_OPEN 成交）；**`parameterRole` = FIXED | TUNABLE | DERIVED**（TUNABLE **必须**带 min&max 或 step，为 Parameter Search 预留）；规范化确定性（parameters 按 code 升序、datasets 按 role/datasetId/datasetVersion 升序、exit.rules 按 priority→id 升序、**entry.conditions 保持声明顺序**=求值顺序、缺省 id 由下标派生）。**旧消费者零破坏**：`legacyViews.ts`（256 行**叶子模块**，避免 `map → validate → map` 循环依赖）把 Definition **单向派生**为 v1 视图（entryRules/exitRules/riskRules/positionSizing/parameters/executionModel/datasetVersion）；组装层「缺则补、显式提供且不一致则报 `SCHEMA_DEFINITION_VIEW_CONFLICT`」，反序列化后复核漂移报 `SCHEMA_DEFINITION_VIEW_DRIFT`；**有损派生逐项登记**（`T_PLUS_2_OPEN → NEXT_OPEN`、`T_CLOSE → LIMIT_PRICE`）。

  **四、Source of Truth + Projection（STEP 8）**：`strategyDocumentJson` 为**唯一** Canonical；5 张表为**查询投影**，`projection.ts`（314 行）只做 `Definition → 投影行`（**单向**，禁反向拼装）；**无 condition 时仍写一行 `EVENT_OBSERVATION`** 承载 event/window/trigger（否则「研究什么事件/观察多久/何时触发」在无条件下凭空丢失）。`db.ts#saveVersion` 改为 `db.transaction`：canonical + §17 追溯记录 + 5 类投影**同一事务**，任一步失败整体回滚（杜绝「Canonical 已写、投影没写」中间态）。`verifyStrategyProjections()` 逐行逐字段 diff 且**同时检出缺失与多余**，漂移非空必须响亮失败、**绝不自动修复**。

  **五、指纹（STEP 9）**：**两层** —— 文档级 `computeStrategyDocumentFingerprint`（落 `fingerprint` 列，覆盖含 definition 的全字段）与定义级 `computeStrategyDefinitionFingerprint`（只覆盖 definition 子树，判「是否同一套规则」）；底层 `canonicalStringify`（键字典序）⇒ 不依赖键插入顺序；**dataset binding 参与指纹**（逐项突变用例覆盖）；反序列化重算比对，篡改抛 `STRATEGY_FINGERPRINT_MISMATCH`。

  **六、Validation + Look-Ahead（STEP 10）**：复用既有 `ResearchValidationResult` / `ResearchValidationIssue` / `ResearchValidationError`（**不另造框架**）；参数数值自洽性**委托**既有 `validateParameterSchema`（保留其错误码如 `VALUE_ABOVE_MAX`，仅把路径 `parameterSchema.*` 重映射到 `parameters.*`）。**Look-Ahead 8 条规则（L1–L8）**：L1 `UNKNOWN_FIELD_TIME_DOMAIN`（无法判定时间域 → **默认拒绝**）、L2 `UNKNOWN_FIELD_REFERENCE`（时间域可判但不在白名单）、L3/L4 `INVALID_FUTURE_REFERENCE`（引用 `path.*`/`outcome.*` 标签层，或 `post.rd{n}` 的 n 超出 `resolveSignalTimeline()` 给出的最早信号偏移）、L5 `SIGNAL_TIMELINE_UNRESOLVABLE`（窗口非 `TRADING_DAY` ⇒ 无法映射交易日坐标系 ⇒ 任何前视引用一律拒绝）、L6 `SIGNAL_EXECUTION_TIMING_CONFLICT`、L7 `TRIGGER_EXECUTION_INCONSISTENT`、L8 `PRICE_TYPE_TIMING_MISMATCH`（VWAP 例外）。🔴 **白名单而非黑名单**（后者可被命名绕过）；严格遵守 Dataset 五层语义（`prefix` PIT 安全 / `post` 前视 / `path`·`outcome` 仅打标签）⇒ 首板日开盘价是 **`prefix.rd0.open`** 而非 `event.open`；时间语义不明 → `UNKNOWN` → 默认不允许作 Signal 引用。⚠️ **诚实边界**：仅**声明层静态**检查，不能证明运行时执行器无旁路读取未来数据 —— 已在代码与报告显式声明，不冒充已解决。

  **七、Clone（STEP 11）**：`cloneVersion(strategyId, fromVersion, options)` —— **源版本可以是任意历史版本**（不限于 latest），`parentVersionId` 指向**源版本行**；复制完整 Definition + universe/datasetVersion/executionAssumptions/recipe/metadata 并**重算指纹**；**幂等三态**（不存在→`inserted`；存在且一致→`idempotent-skip`；存在但内容不同→`conflict`，**绝不覆盖** + 返回 `existingFingerprint`）；并发兜底 `ER_DUP_ENTRY(1062)`。

  **八、F1「双份定义」最终处置**：**未删除** `versionRecordJson`（§17 追溯契约），而是**降级为「可检测的冗余」**（`consistency.ts`）：每次读取/审计断言「列 fingerprint == strategyDocumentJson 重算指纹 == versionRecordJson.strategy.fingerprint」**且** `versionRecordJson.strategy.definition` 与 `strategyDocumentJson.definition` **canonical 串逐字段相等**；不一致 **FAIL**，**不静默修复、不择一覆盖**。`getVersion` / `getLatestVersion` / `getVersionBundle` 全部经过。

  **九、Golden Sample（SPEC §25）**：`goldenSample.ts` —— **首板回踩**（Event `FIRST_LIMIT_UP` / Observation T+1~T+5 / Condition `bar.low >= prefix.rd0.open` + 缩量 / Trigger `FIRST_VALID_DAY` / Signal T 收盘 / Execution T+1 开盘 / Exit TIME_EXIT+STOP_LOSS+TAKE_PROFIT / 5 个 TUNABLE + 1 个 FIXED / Dataset `ds_first_limit_pullback` PRIMARY）。仅作测试与验证 fixture，**不注册进任何 registry、不进 `index.ts` 导出**。

  **十、测试（STEP 12）**：新增 **132 例** —— `strategyDefinition.test.ts` **79 例**（Golden Sample 存在性 / 序列化往返与篡改拒绝 / 指纹 8 项突变 + 两层区分 / 结构校验约 26 项 + 委托错误码与路径重映射 + **issue.path 根相对不变量** / **Look-Ahead 15 例含正例零误报控制** / 视图一致性闸门 / clone 文档组装 / 引用解析与信号时间线）、`strategyDomainPersistence.test.ts` **53 例**（5 类投影派生 + **行形状契约**（列增删必须同步 migration）/ 漂移检测（缺失·多余·字段·顺序·时序·binding）/ **F1 三方指纹 + 双份定义漂移** / Service 编排含 v1 老文档 / **clone 任意源版本 + 幂等三态 + 冲突不覆盖** / 版本不可变 + 状态迁移）。**策略相关 5 文件 / 202 例全过**（既有 `strategyPersistence` 12 + `strategySchema` 28 + `lifecycle` 30 零改动通过）。

  **十一、真实 TiDB 全链验证（STEP 13）**：`scripts/verifyStrategyDomainModel.mts`（477 行）= **89 项检查 / 0 失败 / exit 0**。链路：Migration(information_schema，期望集**由 0034 SQL 的 `@guard` 指令解析而来、不手抄**) → Create → Save(幂等 ×2) → Read → Validate → Clone(inserted/idempotent-skip/conflict 三态 + 既有版本未被覆盖) → Verify Hash（**裸 SQL 读原始列**验三方指纹 + 双份定义）→ **Verify Projection（两级独立证据：Repository 读回 + 裸 SQL 读回，均零漂移）** + **漂移检测器自证**（人为篡改投影必须报出漂移，证明检测非空转）→ 状态迁移（Draft→Research 生效且**内容指纹不变**）→ 清理（级联删除后 **7 表全部回到基线 0，零残留**）。⚠️ **两个真实踩坑**：① **TiDB 保留字 `maxValue`**（`MAXVALUE` 是分区保留字，与既有 `cursor`/`rows`/`rank` 同类）⇒ 裸 SQL 列名**必须**加反引号，首轮因此 57/58 且按设计 `exit 1`；② **成功路径未显式 `process.exit()` ⇒ 脚本永久挂起**（drizzle 连接池占住事件循环，首轮因失败路径 `exit 1` 掩盖）⇒ 已改为无论成败都显式退出。

  **十二、回归（STEP 14）**：`npx tsc --noEmit` **exit 0**；**全量 216 文件 / 3400 例，15 失败 / 7 文件 —— 与既有基线逐项一致**（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch`×4 / `marketData`×4 = 真实 DB 直连；`tushare.secret` + `tushareTradingCalendar`×3 = 外部 API/超时）⇒ **零新增失败，且无一条触及 Strategy 代码**。**顺带修复的类型问题**：`inWhitelist()` 改泛型类型守卫（否则 `unknown` 比较 TS18046）；`timelineResolvable`/`maxForwardOffset` 提作用域；🔴 **等价模块导出冲突（真实发现）**：`experimentValidation.ts` 已有 `validateStrategyDefinition`/`assertValidStrategyDefinition`（STEP 6.1 `strategyContract`），而 `research/index.ts` 用 `export *` 聚合 ⇒ 与 `strategySchema` 新同名导出冲突，故新校验器改名为 `validateCanonicalStrategyDefinition` / `assertValidCanonicalStrategyDefinition`；🔴 **并行会话记录的 2 例失败已修复**（其 16:05 条目看到的 `strategyDomainPersistence.test.ts` 2 例 = 本会话误用 `createStrategyDocumentFromDefinition` 构造「无 definition」历史文档；已改用 `createStrategyDocument`，并给该入口加 definition 缺失守卫 `SCHEMA_DEFINITION_REQUIRED` 让错误响亮失败而非抛底层 TypeError ⇒ 53/53 通过）。

  **十三、产出与边界**：报告 `docs/strategy/STRATEGY-003-report.md`（18 节）+ 审计报告 `docs/strategy/STRATEGY-003-difference-report.md`。**新建 11 文件 / 修改 12 文件**（合计 ~4,915 行新增）。**未越级**：未做 Strategy UI / Research 页面 / Parameter Search / Backtest / Evaluation / Robustness / OOS / Walk-Forward / Simulation；**未改 Dataset Registry、未删任何旧数据、未改物理列名**。**登记不处理**：F7（`server/strategy/` legacy 5 策略并存）、F9（`research_run.id=330003` 永久 `RUNNING`，属 9h / RESEARCH-002D）、`research_experiments.strategyId/strategyVersion` 仍为自由文本冗余列（F2）。**建议下一任务 STRATEGY-004**：Definition 消费侧（可执行解析 / Dataset 绑定引用完整性 / `status` 接入 C-21.1 完整状态机 / F2 绑定收紧）。

- **2026-09-12 16:25 GMT+8 — WORK RESEARCH-005B 内置示例接入「批量建分析」（新增「例子」路线：点一下直接建 + 存为我的模板；纯前端、零迁移、零新端点）**。用户原话：「**还是很乱**，你可以把刚才的分析放在批量新建分析里面的我的模版里面吗」。**这一句里有两个信号**：① 9j 交付的 6 个示例**位置不对** —— 它们只在**单建弹窗**（`CreateAnalysisDialog`）里，用之前仍要先读懂整张表单，等于把门槛前移；② 用户对「新建分析」这条路径本身已经不耐烦，他要的是「在**已有 Run** 上直接建好」，而不是再学一遍单建表单。

  **一、诊断（为什么 9j 的示例到了用户手里仍然不够用）**：批量弹窗（`BatchAnalysisDialog`）的三条既有路线都有**入口门槛** —— 「矩阵展开」要自己勾类型 × 目标 × 视界 × 维度（组合控件最多、空手进来最不知道从哪下手）；「标准套件」要先选一个特征 + 一个目标（要求用户已经知道自己在研究什么）；「我的模板」是**用户保存型**（RESEARCH-002C 定死：必须先有一个配好的分析才能存下来）。⇒ **空手进来的人在任何一条路线上都会卡住**，而 9j 的 6 个示例正好是「不需要用户先知道任何东西」的那份资产，却被放在最难的那扇门后面。

  **二、交付 A —— 第五条路线「例子」（模板页签顶部）**：`BatchAnalysisDialog` 模板页签新增内置示例区，6 张卡片，每条 = **研究问题标题** + **口径提醒（`story`，含「这是事后条件筛选、不是 T 日信号」这类陷阱）** + **摘要行** + 两个动作：「按此创建」与「存为模板」。示例来源与单建弹窗**同一份** `ANALYSIS_EXAMPLES`（禁第二份副本）；缺变量时卡片置灰并写明「本 Dataset 缺少：…」（**不让人点完才被后端拒绝**）；变量目录未到位时不渲染卡片（避免全灰的假象）。

  **三、交付 B —— 路径同源（`analysisBatchForm.ts#formStateToBatchItem`）**：`state: CreateAnalysisFormState → BatchItemDraft`，复用 `toAnalysisConfig` / `conditionGroupsToPayload` / `suggestAnalysisName`，**禁另造「表单 → 载荷」口径**；示例先经 `applyAnalysisExample`（含分段窗按**真实 path 视界**钳制）得到完整表单状态，再转条目 ⇒ **「示例建的分析」与「手动填表建的分析」逐字段同源**。命名上示例卡额外给 `nameOverride = 示例标题`（研究问题式名字，信息量高于 `suggestAnalysisName` 的机械名），**缺省仍回退 `suggestAnalysisName`（唯一权威），不臆造**。

  **四、交付 C —— 一键播种「我的模板」**：顶部一个「把全部示例存为一个模板」按钮（模板名常量 `EXAMPLE_BUNDLE_TEMPLATE_NAME = "首板涨停：内置示例集合"`）⇒ 一次点击把 6 条示例灌成一个模板，之后在「我的模板」下拉里对**任意 Run** 一键铺开 6 项（正是用户「放到我的模板里面」的字面诉求 + 跨实验复用）。⚠️ `research_analysis_template.name` 有**唯一索引**（`research_analysis_template_name_unique`）⇒ 保存前**先用已加载的模板名判重**并把按钮/卡片置为「已存为模板」，**不靠撞库报错兜底**（服务端虽有 `TEMPLATE_NAME_CONFLICT` 可读文案，但那是最后护栏、不该是常态路径）。

  **五、交付 D —— 减负**：页签由「我的模板」改为「**例子 / 我的模板**」，并把它设为**默认页签**（`useState("template")`，附代码注释说明理由：矩阵页签的控件最多但空手进来不知道该怎么选）；「我的模板」空态文案改为指向示例卡的「存为模板」。**交付 E** —— 卡片摘要 `describeBatchItem(draft)` 落在**纯函数层**并从 `BatchItemDraft` **反推**（不从示例声明另抄一份说明）⇒ 卡片显示的一定是**会落库的内容**；配套 3 例单测锁住三种形态（条件 + 目标 / 变量缩略 `首 … 末（共 N 个）` / 分段窗 `窗A T+0..T+5 → 窗B T+5..T+20`）。

  **六、语义边界（重要，已写进 `docs/research/LAYER_CONVENTIONS.md` RESEARCH-002C 段）**：`MATRIX_ANALYSIS_TYPES` 把 `SEGMENT_RELATION` 排除在外，其**理由只约束矩阵展开**（「两个窗就是选题本身，一排窗参数铺开 N 项只会产出 N 个相同配置」）；本次的**单条示例**把两个窗明写在卡片上（`窗A T+0..T+5 → 窗B T+5..T+20`），**不受该排除约束** ⇒ 从示例建单个 `SEGMENT_RELATION` 与原设计**不冲突**。另：`createAnalysesBatch` 的预检只查「名非空 / 类型已实现 / CONDITIONAL 有条件」，**config 合法性在运行期由引擎解析**（所有类型同一口径，本次未引入任何非对称）。契约侧无改动（仍用 `createAnalysisItemSchema` 共用 schema、仍走 `createAnalysesBatch` 落库）。

  **七、验收**：`npx tsc --noEmit` **exit 0**；`npx vite build` **RC=0**（14.96 s）；新增 **10 例**（`analysisBatchForm.test.ts` 28 → **38 例**：`formStateToBatchItem` 7 例（CONDITIONAL 组号/组内序/值元数、DESCRIPTIVE 无 target 无条件、SEGMENT 四窗参数、**遍历全部内置示例逐条断言「过服务端批量预检口径」**、示例标题直接当模板名 ≤120、载荷过 `toBatchCreatePayload` 不丢条件、`missingVariablesForExample` 判据）+ `describeBatchItem` 3 例）；聚焦（`server/researchCore` + `server/researchEngine` + `client/src/components/research` + `client/src/adapters/researchEngineAdapter.test.ts`）**25 文件 / 497 例全过**；**全量 216 文件 / 3411 例，15 失败 / 7 文件** —— `dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`，**全部真实 DB 直连 / 外部 API / 5s 超时环境依赖，与既有基线逐项一致** ⇒ **零新增失败**（**并实证** 9j 条目记录的 2 例并行 STRATEGY-003 失败已随 9k 收口）。**未触碰** `ds_*` 与 dataset 页面；**未改任何分析口径、未改涨停判定、未新增/修改任何 DDL**（纯前端 + 1 处分层约定文档）。

- **2026-09-12 16:45 GMT+8 — WORK AUDIT-DRS-001 Dataset + Research + New Strategy 联合架构审计（AUDIT ONLY，零代码/零 schema/零 DDL/零数据修改）**。产出 `AUDIT-DRS-001-EVIDENCE.md`（21 节）。**方法**：以**当前代码 + 真实 TiDB 实查**为准，不采信历史报告（探针落系统临时目录，仓库根零新增源文件）。

  **一、三模块真实状态（实查）**：Dataset **可用** —— `dataset_definition` 1 行 / `dataset_version` **2 行**（v1=390001 READY 1,130 事件 / 60,002 行；v2=390002 READY 23,978 事件 / **1,543,082** 行，窗口 2024-08-31→2026-08-31）/ `dataset_build_job` 4 行（含 job 540001 被**孤儿回收**真实生效：`orphan reclaimed：停更 55 分钟`）；五表五层齐备且逐版本行数与 `totalRows` **逐字相符**（v2: 23978+503538+471816+471816+71934 = 1,543,082）。Research **可用** —— `research_experiment` 2 / `research_run` 8 / `research_analysis` 19 / `research_result` **674** / `research_conclusion` 7；`researchEngine` **30 个 tRPC 端点**；`inputSnapshotJson` 真实落 `datasetVersionId + datasetCode + datasetVersionLabel + snapshotAt`（可追溯性 **IMMUTABLE**）。New Strategy **模型完整但成孤岛** —— 7 张表实查存在、当前**全部 0 行**，canonical SoT / 单向投影 / 两层指纹 / L1–L8 全部成立。

  **二、核心发现（P0，本轮最重要）——Dataset 版本标识**双轨**：新 Dataset Registry 用 `version = "v1"/"v2"`（`shared/datasetRegistryContracts.ts:61` `DATASET_VERSION_LABEL_PATTERN`），而 Strategy 的 Dataset 绑定校验器 `isValidDatasetVersionFormat`（`server/research/experimentLineage/validate.ts:51-58`）用 `DATASET_VERSION_FORMAT_RE = /^rd-\d+\.\d+\.\d+-\d+-[0-9a-f]{16}$/`，其单测**明确锁定 `isValidDatasetVersionFormat("v1") === false`**（`experimentLineage.test.ts:245`）⇒ **新 Strategy Version 无法合法绑定 Research 用过的 `v1`/`v2`**；Strategy UI 侧同样错位（`StrategyBasicInfo.tsx:42` 用 **旧** `researchDataset.list`，而 Research UI `CreateExperimentDialog.tsx:66,84` 用 `datasetRegistry`）。叠加：**全库 0 外键**、绑定**零引用完整性校验**（`definitionValidation.ts:759-765` 只校验格式不查库）。⇒ Research → Strategy 的交接**连一个合法数据坐标都不存在**。

  **三、§18 断点地图（按真实代码判定，未预设）**：断点① = **坐标断点（唯一根断点）** Strategy ⇄ Dataset Registry 版本标识不接头；断点② = Research 无法消费 Strategy Version（判定 **NOT CONNECTED**：`research_run`/`research_analysis`/`research_result` **零 strategy 列**实查；`research_strategy_candidate` 0 行且**无创建路径**；`loopRun` 执行的是内置注册表策略、**不读 `strategy_versions`**）；断点③ = Definition → 可执行实例解析器缺失（属 Backtest 方向，不触碰）。**① 是 ② 的必要条件**（② 的实现必然要写 Dataset 绑定，① 未修只能产出非法/虚假绑定）。

  **四、8 个研究问题判定（§6）**：A/B/C/E/F **SUPPORTED**；D **PARTIAL**（多 horizon 仅 `EVENT_STUDY`）；G **regime NOT_SUPPORTED**（`researchEngineRouter.ts:210-211` 显式声明 `unavailableDimensions`）/ industry MISSING（v2 `industryCode` **99.47% NULL**）/ board 退化（distinct=1，全 `main`）；H **NOT_SUPPORTED**（Strategy 不是 Research 的输入）。**探索性研究(A)** 完成度 ~85%，**策略研究(B) = 0%**。

  **五、Legacy Strategy 依赖（§9，仅登记不改）**：`server/strategy/`（**1 个**策略 `leaderCandidateBaseline` + registry + adapter）**ACTIVE**（`db.ts:2207`、`research/adapter.ts:15`）；`paramSearchRouter` / `walkForwardRouter`（`routers.ts:294-295`，前端各有页）**ACTIVE**；`leaderCandidates` / `downsideRisk`（5 策略）/ `realisticBacktest` / `backtestCache` / `signalEngine` / `simulator` **ACTIVE**；`research/experiment*.ts` / `runService.ts` / `engineAdapter.ts` **COMPATIBILITY**（仅测试可见）。**否**，不应继续作为主模型；本轮**不重构**。

  **六、新登记风险 R1–R12（本轮不修）**：R1 版本标识双轨｜R2 绑定零引用完整性｜**R3 `updateAnalysis` 改 `config` 不失效旧结果**（仅 `setAnalysisConditions` 会失效）｜R4 **Research Run 无孤儿回收**（已知，run 330003 已于 15:37 人工收敛）｜R5 无 worker 消费 PENDING｜R6 两套 Dataset + 两套 Research 表并存（表名仅差一个 `s`）｜**R7 Strategy 端点全 `publicProcedure`**（Dataset/Research 写端点均 admin）｜R8 Look-Ahead 仅覆盖声明层｜R9 `research_run` 无 `datasetVersionId` 列（追溯需 4 跳 join）｜**R10 v2 数据广度**：`marketCap`/`floatMarketCap` **100% NULL**｜R11 version status 无迁移守卫｜R12 F2 自由文本残留。

  **七、最终唯一推荐 STEP = STRATEGY-004（Strategy ↔ Dataset 绑定对齐与引用完整性）**：① 版本标识对齐（以 `datasetVersionId` 为权威引用、保留 `rd-…` 兼容分支）；② 绑定写入前查 `dataset_version` 断言「存在 且 `status=READY`」，失败响亮抛错、不自动补；③ 把 STRATEGY-003 **已建但未暴露**的 `loadBundle`/`validateVersion`/`cloneVersion`/`setVersionStatus`（`service.ts:209/258/306/320/345`）接入 tRPC 并统一 `adminProcedure`；④ Strategy UI 的 Dataset 绑定由 `researchDataset` 切到 `datasetRegistry`。**不碰** Dataset / Research / Legacy / Backtest / Parameter Search。**明确不做**：C2 结论→策略交接（**前置 = 本 STEP**）、C3 可执行解析器（属 Backtest）、C4 Dataset 广度（用户已明确 Dataset 不再开发）、C5/R3 局部小修、C6 孤儿回收、C7 清理 Legacy（禁止）。**未修改**：Dataset / Research / New Strategy / Legacy 全部零改动；未新增表、未建 migration、未改 schema/API/前端；未修复任何发现问题。产出仅 `AUDIT-DRS-001-EVIDENCE.md`。

- **2026-09-12 17:05 GMT+8 — WORK RESEARCH-006 结果可读性第二轮 + Run 450001 结果诊断（纯前端：零后端改动 / 零迁移 / 零新端点）**。用户原话：「**390003这个研究结果是不是有问题**。而且**所有的研究结果感觉都不够直观**，有没有办法更直观一下」。**这一问里藏着两件事**：一件是要我**核实一个具体数字**，另一件是**对整套结果的呈现方式不满意** —— 后者才是真问题，因为「看不懂」会让人连「算错了」和「写得看不懂」都分不开。

  **一、`390003` 是什么（真实库只读实查，探针跑完即删）**：它是 **`research_analysis.id`** —— 既不是 run（该表 run 段是 450001），也不是 dataset version（`dataset_version` 只有 390001=v1 / 390002=v2）。它属于 `runId=450001` / `experimentId=240002`，类型 `SEGMENT_RELATION`，名字「前 5 日跌得越深，之后 15 日越强吗」，配置 `{windowA:[0,5], windowAStat:"max_drawdown", windowB:[5,20], windowBStat:"return", windowBands:5}` —— 正是 9j/9l 那批**内置示例**建出来的其中一个。**定位过程中的一个关键判断**：不能因为「用户说了个数字」就去猜它是哪个 id 段，直接把三个候选段（run / experiment / analysis / dataset_version）都查一遍，才排除了前两个。

  **二、数值「算得对」——口径自洽，逐行核对通过**：① `windowA` 的 `from=0` ⇒ 按 `windowOutcomeVariableName`（`variables.ts:800`）**复用 Dataset 既有变量** `max_drawdown_5d`（=`min(close[T+1..T+5])/close(T) − 1`，事件日**只作分母** —— `path.ts#buildOutcomeRow` 已 `filter(b => b.relativeDay >= 1 && b.relativeDay <= horizon)`）；`windowB` 的 `from=5` ⇒ 新造分段变量 `segment_return_5_20d`（=`close(T+20)/close(T+5) − 1`）。两窗**取值窗** `[1,5]` / `[6,20]` **无重叠**，`WINDOW_OVERLAP` 硬前提成立。② **实测（落库逐行）**：5 档窗 B 均值 = 档1 **+0.194%** / 档2 +0.416% / 档3 −0.038% / 档4 −0.076% / 档5 **−1.608%**；`SPREAD_TOP_BOTTOM` **−1.802%**、`T_STAT_DIFFERENCE` **−4.542**、`P_VALUE_DIFFERENCE` **5.57e-6**、`PAIR_CORRELATION` −0.0317 / `PAIR_RANK_CORRELATION` −0.0682；配对 n=**22,944**（`excludedForMissing` = 1,034，两侧同时有限才成对、不插补）。

  **三、🔴 真正的问题不在数字，在表述 —— 三处会让人读反**：**(a) 档号不含方向**：`cutPoints = [−9.11%, −5.03%, −1.95%, +2.01%]` ⇒ **档 1 = 跌幅最深、档 5 = 跌幅最浅（甚至「5 日内最低收盘还高于事件日收盘 2%」）**，而结论文本只写「第 5 档 − 第 1 档 = −1.8%」。读者默认会把「第 5 档」读成「跌得最狠那批」⇒ **符号恰好读反**。**(b) `SPREAD_TOP_BOTTOM` 的 top/bottom 是「分组变量值」的首尾，不是「跌得深浅」**：对「跌幅」这种越负越严重的变量，`top − bottom` 天然为负 —— 与「跌得越深，之后越强吗」的直觉**正面打架**（本例真实答案是「**越深之后反而略强**」：跌最深批 +0.19% vs 跌最浅批 −1.61%）。**(c) 术语错配**：前端把该指标中文名写作「**顶底分位差**」——「分位」是 QUANTILE 的术语，用在 SEGMENT_RELATION 的「档」上不成立。**附带发现（同一 Run 的另两个对照分析）**：`holds_event_low_5d == 1` 条件组 **16,158 笔 / 均值 +5.186% / 胜率 51.86%**，`== 0` 条件组 **6,747 笔 / 均值 −8.211% / 胜率 25.08%** ⇒ 两组直接差 **≈13.4pp**；但落库结果**只有 `ALL` 与 `CONDITION` 两组、没有「对照组」列**，`DIFFERENCE` 一律定义为「条件组 − **全样本**」⇒ 想看「破 vs 不破」得开两个分析再自己心算，且极易把分母当成另一组。

  **四、交付（纯前端，A–G 七项）**：**A 一句话结论卡** —— 新增 `researchEngineAdapter.ts#buildHeadline(rows, blocks)`，从**已落库**的 SCALAR 与分组块里搬出「主语组 / 参照组 + 差值 + 引擎写入的差值口径 + t / p + 样本数」，**不产生任何新数字**（展示层无权造数）；**B 分档区间** —— 新增 `groupRangeLabelOf(details, dimension)`，由落库 `cutPoints` 反解（首档 `≤ c₀` / 中间 `(c_{k-2}, c_{k-1}]` / 末档 `> c_{G-1}`，与引擎 `band(v) = 1 + |{k : v > percentile_k}|` **同源**），在分组标签下直接显示「≤ −9.11%」「> +2.01%」⇒ **档号方向不再靠猜；（a）被消除**。**C 分档条形** —— 主指标列加**共用横轴（强制含 0）+ 0 参考线**的条，涨红跌绿（A 股习惯，收益为正 = 红）；含 0 是关键：否则「−0.5%」会比「+0.4%」冒出更长的条，一眼读反。**D 差值口径上表** —— `ResultRowVm.comparisonDefinition` 原样带出 `differenceDefinition` / `spreadDefinition`（「谁减谁」的**唯一**权威定义，前端**禁改写** —— 改写了就会出现「表格是条件组−全样本、文案是条件组−对照」的自相矛盾）。**E 术语纠正** —— `SPREAD_TOP_BOTTOM`「顶底分位差 → **最高组 − 最低组**」（对 QUANTILE 与 SEGMENT_RELATION 都成立）、`DIFFERENCE`「差值 → **组间差值**」⇒（c）被消除。**F 排序修复** —— `dimensionNumericValue` 补 `windowA`（漏掉时 10 档会退化到字符串序、把「档 10」排到「档 2」前；5 档看不出问题，属潜伏缺陷）。**G 白名单守卫** —— `buildHeadline` 只对**有序**维度（`quantile`/`windowA`/`horizon`/`group`/`year`/`month`/`quarter`）生成，名义分类（`variable`/`board`/`industry`）**直接返回 `null`**：「换手率 vs 成交量」之间没有「顶底差」可言，硬算就是凭空造结论。

  **五、⚠️ 自查纠错（本轮真 bug，测试抓到后修）**：`buildHeadline` 初版按「**结果值**最高 / 最低」选顶底档 ⇒ 与引擎落库的 `SPREAD_TOP_BOTTOM`（**末档 − 首档**）**口径不一致** —— 本例结果值最高其实在**档 2**（+0.416%），不是档 5 ⇒ 文案里的差值会与表格里的 spread 数字对不上。**改为严格复刻引擎口径**（分档 = 末档 − 首档；条件 = 条件组 − 全样本），并加断言 `primary.value − reference.value ≈ spreadValue` 把两者锁死。**教训**：展示层「自己做一遍取极值」是最容易与引擎口径漂移的地方 —— **能搬运就不要重算**；（b）的误导性正是「重算口径」与「引擎口径」不一致的产物。

  **六、验收**：`npx tsc --noEmit` **exit 0**；`npx vite build` **RC=0**（26.92 s）；`researchEngineAdapter.test.ts` **24 → 34 例**（+10，覆盖「分档端点反解」「档号方向」「非分档不臆造 / 档号越界不臆造」「名义维度不硬凑」「条件分析的组定位与差值口径」「分组不足 2 组不硬凑」）；聚焦 `client/src/adapters` + `client/src/components/research` **8 文件 / 202 例全过**；全量 **216 文件 / 3419 例，15 失败 / 7 文件** —— 失败集合（`image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`，全部真实 DB 直连 / 外部 API 环境依赖）与既有基线**逐项一致** ⇒ **零新增失败**。**未触碰** `ds_*`、dataset 页面、任何分析口径与涨停判定。

  **七、登记不处理（需改 `server/**` ⇒ 会热重启 dev server，待用户裁定）**：① `segmentRelation.ts` / `quantile.ts` 的 `summary.effectLabel` 仍写「第 5 档 − 第 1 档」—— **已落库的历史结论文本不会因前端改动而变**（本次只治了「看结果」这条路径，「看结论」页签仍是旧文案），建议在 effectLabel 内联档位区间；② `conditional.ts` 只产出 `ALL` / `CONDITION` 两组，建议补 **`COMPLEMENT`（对照组）** 第三组，使「破 vs 不破」不必开两个分析再心算（这也是本次唯一未能从展示层解决的问题 —— 结果里根本没有那个数）。

- **2026-09-12 17:45 GMT+8 — WORK RESEARCH-007 结果页图形化重做：修掉负值条形 bug + 独立分档图 + 反推「对照组」（纯前端：零后端改动 / 零迁移 / 零新端点 / 零新依赖）**。用户原话：「**效果还是不直观，加的统计图有点问题**」。**两句话对应两件事**：① 「统计图有点问题」= 9m 交付的图里有一个**会让人读错数据**的真 bug；② 「还是不直观」= 图**放错了位置**（塞在表格单元格内），而不是「图不够多」。

  **一、🔴 真 bug：负值条被压成 0.8% 宽的一条细线**。`AnalysisResultsView.tsx#ValueBar` 先取 `anchor = Math.min(value, 0)`，再算 `widthPercent = (value − anchor) / span` —— 当 `value < 0` 时 `anchor === value`，该差**恒等于 0**，再被 `Math.max(widthPercent, 0.8)` 兜成 0.8%。**后果**：在「有正有负」的分档图上，**所有负值档都只剩一条几乎看不见的细线**，看起来像「那几档没有数据」。390003 正是这种情形（5 档窗 B 均值 +0.194% / +0.416% / −0.038% / −0.076% / −1.608%，3 负 2 正）—— 最需要看方向的一类分析，被画得完全失真。**正确写法**是 `widthPercent = (Math.abs(value) / span) * 100`。这个 bug 也说明一件事：**上一轮我为「含 0 横轴」写了三条纪律，却没为「负值区间」写一个断言** —— 单测只覆盖纯函数（adapter），组件内的几何计算没人管。

  **二、结构性不可读：条形不该住在表格里**。单元格内的条 ~72px 宽 × 1.5px 高，且表格横向滚动时整条一起跑出视口。「单调性一眼可见」这个目的达不到 —— 不是参数没调好，是**位置错了**。

  **三、交付（A–D 四项）**：**A 独立图表** —— 新增 `client/src/components/research/GroupMetricChart.tsx`（recharts `BarChart layout="vertical"`，**零新依赖**：项目已有 `recharts ^2.15.2`，`client/src/components/ui/chart.tsx` 与 `--chart-1..5` 变量也早已存在）：每档一行、**共用强制含 0 的 x 轴**、`ReferenceLine x={0}`、涨红跌绿、**两行式 y 轴刻度**（上行档名 / 下行区间）、tooltip 带区间 + 样本数 + 中位数/胜率/标准差；高度 `max(150, n·40 + 48)`；文字与网格走 `currentColor` ⇒ 明暗主题都成立。**踩到的实现细节**：recharts 的 `tick` 只有写成**箭头函数**时才会把 `x/y/payload` 注进来；写成 `ReactElement`（`tick={<TwoLineTick byName={…} />}`）会走 `cloneElement` 路径，自定义 props 传不进去且 **TS 直接报错**（`Type '{ byName: … }' is not assignable to type 'IntrinsicAttributes'`）；且 tick 组件的 props 类型**不能是 `unknown`**（那样 JSX 会拒绝一切属性）。**B 删掉表格内迷你条** —— 表格回归纯数字，主指标列表头 + 单元格**加粗高亮**回答「该看哪一列」；`ValueBar` 连注释一并删除，不留死代码。**C 🔴 反推「对照组」** —— 新增 `estimateExcludedGroupMean(allMean, allCount, conditionMean, conditionCount)`：`n_all·M_all = n_c·M_c + (n_all−n_c)·M_rest` ⇒ `M_rest = (n_all·M_all − n_c·M_c) / (n_all−n_c)`。这是**恒等变形**（前提只有「条件组 ⊆ 全样本且互斥」，即条件分析的定义），**不是重新定义口径**，因此结果是**精确值**而非估计；但它对输入敏感（四个数必须取自**同一指标**），且**只对均值型指标开放**（`MEAN_RETURN` / `MEAN` / `WIN_RATE`）—— 中位数、标准差是非线性统计量，反推会变成真正的估计/假设，一律返回 `null`。图上以**浅色 + 同色虚线描边**标为「（反推）」，tooltip 写「由全样本与条件组反推」⇒ **实测样本与反推值在视觉上绝不混同**。**D 对照组相邻** —— 反推条插在「全样本」**之前**（`GroupMetricChartComplement.before`，按 `name` 匹配、匹配不到则追加末尾），让「满足条件 / 不满足条件」这对真正的对照组相邻可比。

  **四、⚠️ 这一轮的判断题（记录下来，下次还会遇到）**：9m 我判定「补对照组必须改后端」，本轮我用恒等式在**展示层**把它算了出来 —— **两句话都对，边界是「能不能用恒等式闭合」**。均值（含胜率，它是 0/1 的均值）可以；中位数、标准差、分位数不行。**判据**：如果展示层能**从已落库数值无损还原**某个量，那就是搬运/变形，可以做（但仍要标注来源）；如果要做**任何假设或估计**，就必须回到后端补真数据。我按这条边界把 `MEAN_RETURN` / `MEAN` / `WIN_RATE` 放进白名单，其余一律不给 —— **宁可缺数，也不给可疑数**。

  **五、验收**：`npx tsc --noEmit` **exit 0**；`npx vite build` **RC=0**（25.48 s）；`researchEngineAdapter.test.ts` **34 → 40 例**（+6，含恒等式验算 / 条件组=全样本时返回 `null` / round-trip 无损还原 / 计数缺失或非正 / 均值非有限数）；聚焦 `client/src/adapters` + `client/src/components/research` **8 文件 / 208 例全过**；全量 **217 文件 / 3460 例，15 失败 / 7 文件** —— 失败集合（`image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`，真实 DB 直连 / 外部 API 环境依赖）与既有基线**逐项一致** ⇒ **零新增失败**。**未触碰** `ds_*`、dataset 页面、任何分析口径与涨停判定。

  **六、⚠️ 未完成的验收手段**：想用 `agent-browser` 实机截图确认渲染（y 轴标签是否压叠、条形是否溢出），但 `agent-browser open http://localhost:3000/research` **6 分 13 秒零输出**（疑 Chromium 冷启动 / 未安装），已 `TaskStop` 放弃。⇒ 本轮图的验收只到 **类型 + 构建 + 单测**三关，**视觉正确性仍待用户实机确认** —— 这一点必须如实登记，不能拿「tsc 过了」冒充「画对了」。

  **七、登记不处理**：9m 的两条后端遗留**仍未做**（① `segmentRelation.ts` / `quantile.ts` 的 `effectLabel` 仍写「第 5 档 − 第 1 档」；② `conditional.ts` 只产出 `ALL` / `CONDITION`，建议补 `COMPLEMENT` 真组）。本轮只在前端做出「等价对照组」的**视图**，**「结论」页签的文案与落库结果结构都不变** —— 用户若认为这个反推组可信、应长期保留，下一步就该把它**落到后端**（成为第 3 个真分组），而不是长期依赖展示层推导。

- **2026-09-12 18:20 — STEP STRATEGY-004 完成：Strategy ↔ Dataset Registry 绑定对齐与引用完整性（状态 VALIDATED；禁止越级 RESEARCH_READY）**。承接 `AUDIT-DRS-001` 判定的唯一根断点（Strategy 绑定校验只认 `rd-…` 正则、新 Registry 版本是 `v1`/`v2` ⇒ **新 Strategy Version 无法合法绑定 Research 用过的 Dataset**，叠加全库 0 外键 + 绑定零引用完整性）。**A 坐标统一**：`datasetVersionId = dataset_version.id` 成为跨模块唯一引用；`datasetVersion` 降级为显示 / 快照 label；`drizzle/0035_strategy_dataset_binding_version_id.sql` 给 `strategy_versions` + `strategy_version_datasets` 各加一列（+ 各一索引），`scripts/applyStrategyDatasetBindingVersionId.mjs` 以 `-- @guard:` 指令 + `information_schema` 断言幂等（实跑 4 条 DDL → `--check` PASS → 二次全 skip）。**B 引用完整性**：新增 `server/research/strategyPersistence/datasetBindingValidation.ts`（纯领域判定 + 只读端口；`evaluateDatasetBinding` / `collectStrategyDatasetBindingRequests` / `assertStrategyDatasetBindings`），三错误码 `DATASET_VERSION_NOT_FOUND` / `DATASET_VERSION_NOT_READY` / `DATASET_BINDING_INVALID`；**在 `db.ts#saveVersion` 的事务内**执行（与写入同一一致性边界，非「先存后校验」）；`InMemoryStrategyRepository` 用**故意恒失败的端口**（宁可失败不静默通过），并保留 `rd-…` 兼容分支（不做 DB 校验、显式标注「未校验」、与 label 禁止互相冒充）。**C 暴露 STRATEGY-003 能力**：`research.strategy.*` 新增 `loadBundle` / `getVersionBundle`（同实现别名）/ `validateVersion`（读，public）/ `cloneVersion` / `setVersionStatus`（admin）；`create`/`save`/`delete`/`createVersion` 收紧为 `adminProcedure`（写操作）；`shared/researchContracts.ts` 新增 2 个输入 schema。**D UI 同源**：`StrategyBasicInfo.tsx` 移除 `trpc.researchDataset.list`，改用 `datasetRegistry.listDefinitions / getDefinition / getVersion`（与 Research 新建实验同源），非 READY 版本 `disabled` 显示不可选，选择写入坐标 + label + 派生 universeId，重新打开由 `getVersion` 反查归属定义回显；`strategyAdapter` 无损透传 `datasetVersionId`。**验收（全部真实，非 mock）**：`scripts/verifyStrategyDatasetBinding.mts` **101/101 PASS（连跑两次一致）** —— 真实 `dataset_version` 390001→v1 / 390002→v2 均 READY；走 **真实 tRPC `appRouter.createCaller`** 覆盖 13 端点；裸 SQL JOIN 确认 `strategy_versions.datasetVersionId = 390002` → `dataset_version.version = v2` → `status = READY`；非法引用 6 类逐条**零写入**（同事务回滚）；legacy 坐标落 NULL；`scripts/verifyStrategyDatasetBindingUi.mts` **46/46 PASS**（选择器真实选项 / READY 门禁 / UI→tRPC→DB 三方坐标一致 / legacy 不下发键）。**顺带修真实缺陷**：`StrategyService#patchToInput` 传 `definition` 时仍透传 base 的 v1 视图，与 `cloneStrategyDocument` 契约相反 ⇒ `createVersion(带 definition)` **恒失败**（`SCHEMA_DEFINITION_VIEW_CONFLICT`），已对齐为「传 definition 即不下发视图、由组装层派生」。**回归**：`tsc --noEmit` exit 0；范围套件 **17 文件 / 408 例全过**；STRATEGY-003 `verifyStrategyDomainModel.mts` **89/89 PASS**（同步补新投影列的裸 SQL 读取）；全量 vitest **217 文件 / 3460 例 / 15 失败 / 7 文件**，与相邻会话 §47 上一轮记录的失败集合**与总数逐项一致** ⇒ 零新增失败。**未触碰**：`server/datasetRegistry/` / `server/strategy/`（legacy）/ `server/researchEngine/` / `server/researchCore/` 在 STRATEGY-004 窗口内**零文件改动**（`find -newermt` 为空）；Dataset 四表行数与逐行内容全程未变；未动回测 / Executor / 参数搜索 / OOS / Walk-Forward / Simulation；未做 Research → Strategy（SPEC §7 明令）。**遗留登记（未处理）**：① 真实库无非 READY 版本 ⇒ NOT_READY 目前靠只读端口覆盖验证；② 无外键 ⇒ 校验─提交间存在应用层残留窗口（已在 `db.ts` 注释登记）；③ `scripts/verifyDatasetRegistryRead.mts` 硬编码 10,240 事件 vs 现实 23,978 ⇒ FAIL，属 DATASET-002.3 陈旧基线，SPEC §8 禁止改动故**未修**。**依据**：`docs/strategy/STRATEGY-004-report.md`（11 节）、`AUDIT-DRS-001-EVIDENCE.md`。

- **2026-09-12 18:10 GMT+8 — WORK RESEARCH-008 `DESCRIPTIVE` 多变量结果改走「有序序列趋势图」+ 补齐 `volume_ratio` 中文名（纯前端：零后端改动 / 零迁移 / 零新端点 / 零新依赖）**。用户原话：「**39004这个有问题吧**」。**这一问最值得写下来的地方是：我核查后判定「数字没问题」，而「没问题」本身是需要证据的** —— 若只回一句「数据是对的」，用户没法判断我是查过还是在敷衍。
  **一、定位（真实库只读）**：`390004` = `research_analysis.id`（`runId=450001` / `exp=240002` / 类型 `DESCRIPTIVE` / 名「首板后 5 天的量能长什么样」/ cfg `{variables:[volume_ratio_1d,…,volume_ratio_5d]}`）。**同时再证它不可能是别的 id**：`ds_*` 物理表 `datasetVersionId` **distinct 只有 390001 / 390002**（与 9m 记录一致），run 段是 450001 ⇒ 用户打的「39004」只能是这条分析。
  **二、真数据核查 ⇒ 数字全对（四条独立证据）**：① **可复现性** —— `|volumeRatio − volume(rd)/volume(0)| > 1e-9` 的行数 = **0**（300 万行量级上的逐行核对，不是抽样）；② **分母健康** —— 事件日 `volume` **min = 1,411.46 手、零 NULL、零 0** ⇒ `MAX` 65.1 / 137.9 / 181.6 / 139.5 / 170.4 与 `MIN` 0.0364~0.0032 都是**真实行情**（一字板几乎无成交、开板日巨量），不是除零或数据脏；③ **样本数对位** —— 该分析的 5 个 `SAMPLE_COUNT`（23,917 / 23,893 / 23,884 / 23,815 / 23,751）与物理表 `volumeRatio IS NOT NULL` 行数**逐一对上**；④ **交叉验证** —— `volume_ratio_1d` 的 `P10 = 0.807` ⇒ `volume_ratio_1d < 0.8` 应命中 ≈10%，而 390005 落库 `conditionSampleCount/totalSampleCount = 2,228/23,030 = 9.7%`，一致。
  **三、真正的问题全在呈现层（三处）**：**(a) 行标签是半工程名** —— 9j 新增 `volume_ratio_{h}d` 时漏登记族名，`variableLabelOf` 落到通用分支返回「volume_ratio T+1」；**(b) 这类结果画不出图** —— `HEADLINE_DIMENSION_KEYS` 排斥 `variable` 本身是对的（名义分类没有「顶底差」可言），但 `volume_ratio_1d..5d` 的 5 个「组」其实是**同一物理量的 5 个时点**，横轴是**时间**，被拍成并列类别后「逐日衰减」这个唯一有价值的信息就消失了；**(c) 均值与中位数给出相反结论，而默认把均值列放在前面** —— 中位数 1.40 → 1.11 → 0.98 → 0.92 → **0.86**（**T+3 起缩量**），均值 1.77 → 1.59 → 1.49 → 1.42 → **1.34**（全程「放量」），偏度 11.7~28.2、峰度 262~1,217 ⇒ **只读均值会得出与中位数完全相反的方向**。
  **四、交付**：**A** 提出模块级 `HORIZON_FAMILY_LABEL`（`variableLabelOf` 与趋势图**共用一份**，禁两处各抄一份）并补 `volume_ratio: "量比"`；**B** 新增 `FAMILY_BASELINE` —— **量比的基准线是 1 倍（与涨停日持平）而不是 0**（基准画错，全正序列里「缩量」与「放量」看上去都「远高于基准」，方向信息直接丢失）；**C** 适配层新增 `buildVariableSeries(blocks)` 纯函数：判定「每块维度只有 `variable` / 变量名同族 `{family}_{h}d` / 滞后互不重复 / ≥2 点」，命中才给序列，**不硬凑**；**D** 新增 `VariableSeriesChart.tsx`（recharts `LineChart`）：x = T+1…T+5、**中位数与均值同时画**、`ReferenceLine y = 1`、偏度 > 2 时图上直接提示「请以中位数为准」、tooltip 带 P25 / P75 / 样本数、**刻意不用涨红跌绿**（量比不是价格涨跌，套涨跌色会被读成方向性涨跌）；**E** 结果页在分组表**之上**插入「量比逐日走势」卡（`buildVariableSeries` 与 `buildHeadline` **互不冲突**）。
  **五、⚠️ 本轮踩到的技术坑（已写进记忆）**：① `Tooltip` 的 `content` 写成 ReactElement 且目标组件 props 类型为 `unknown` 时，**JSX 会直接拒收属性**（`TS2322: Property 'lines' does not exist on type 'IntrinsicAttributes'`）⇒ 改为**普通函数调用** `content={(p) => renderSeriesTooltip(p, lines)}`，绕开 JSX 属性检查；② `Line` 的取值用**展平到顶层的字符串 `dataKey`**（`v_<metricCode>`）而不是函数式 `dataKey`（跨 recharts 版本行为不一致，字符串键各版本都稳）。
  **六、验收**：`npx tsc --noEmit` **exit 0**；`npx vite build` **RC=0**（16.39 s）；`researchEngineAdapter.test.ts` **40 → 46 例**（+6：中文名防回归 / 量比族基准 = 1 且点按滞后升序 / 收益族基准 = 0 / 指标码去重保序 / 三类「不认」/ 滞后重复与单点）。**未触碰** `ds_*`、dataset 页面、任何分析口径与涨停判定；**未做**实机截图（沿用 9n 的 `agent-browser` 冷启动无输出结论 ⇒ **视觉验收仍待用户实机确认**）。**登记不处理**：9m / 9n 的两条后端遗留（`effectLabel` 档位文案、`conditional.ts` 补 `COMPLEMENT` 组）**仍未做**。

- **2026-09-12 18:35 GMT+8 — WORK RESEARCH-006.0（架构线）Research → Strategy Candidate/Draft 架构审计与接口设计（**纯审计 + 设计：零 schema 改动 / 零 migration / 零业务代码改动 / 零数据迁移**）**。用户指令 26 节规格。**一、审计方法（不由文档推测）**：直接读当前源码（`server/researchCore/` + `server/researchEngine/` + `server/research/strategySchema|strategyPersistence/` + `server/strategy/` + `shared/researchContracts.ts` + `drizzle/schema.ts` + `client/src/components/research|strategy/`）+ **真实 TiDB 只读实查**（新增探针 `_r006_probe.mjs` → 证据 `_r006_probe_result.md`，查 `information_schema` 的列/索引/外键 + 12 张 `research_*` / 6 张 `strategy_*` / 3 张 `dataset_*` 行数与状态分布）。**二、最重要的发现 —— 桥已经建好，只是两头没接线**：🔴 `research_conclusion`（**7 行，全 `DRAFT`，5 SUPPORTED / 2 PARTIALLY_SUPPORTED**）与 🔴 `research_strategy_candidate`（**0 行**）**都已存在**，`server/researchCore/candidates.ts` 的**机读状态机**（`CANDIDATE_TRANSITIONS` = `DRAFT→REVIEW→ACCEPTED→CONVERTED→ARCHIVED` + `assertCandidateTransition` + `assertCandidateConversionCoherence`）与 `repository/contract.ts:219-225` 的**完整 Repository 契约**（`create/getById/list/update/delete`）**均已实现**；⇒ **`RESEARCH_CONCLUSION` 与 `STRATEGY_CANDIDATE` 都不是 NOT IMPLEMENTED，缺的只是「调用点」**（全库 `candidates.create` **零调用**；`maintenance.ts` 只用 `list`/`delete`）。故本次**不新建任何 Candidate 对象**，只设计「激活既有写入位」。**三、六个真实断点（附代码坐标）**：B1 Candidate 无写入路径（表 0 行、`CandidatesPanel.tsx` 只能常年显示空态，其注释已自陈「为后续阶段预留的写入位」）；B2 Conclusion **只有引擎规则式生成**（`engine.ts:311` → `conclusion.ts#buildConclusion`）、**无 create/update 端点** ⇒ `status` 永远停在引擎写入值、无法「定稿」；B3 Candidate ↔ Strategy **零连接**（`strategyDefinitionId` 建了索引但无写入者）；B4 `strategy_versions` 真实列中**无任何 research 溯源列**（实查 15 列逐列核对）；B5 `research_result`/`research_analysis`/`research_run` **零 dataset 相关列** ⇒ 坐标只能经 `candidate→experiment` 一跳派生；B6 `research.lifecycle.transition` 是**无状态纯函数**（客户端传 record 进、服务端算新 record 返、**不落库**），而 `setVersionStatus` 是落库路径 ⇒ 两套「状态真相」。**四、Research 是否具备上游资格（指令 §19 六问）**：❌ **A Result 不是 immutable** —— `engine.ts:712-714` `if (resetExistingResults) results.deleteByAnalysis(id)` 再 `createMany` ⇒ **重算即替换**（`setAnalysisConditions` 亦主动删旧结果）⇒ **Result 不能作 provenance 锚点**；❌ **E Conclusion→Run 不能列级反查** —— `research_conclusion` **无 `runId`**，只能两跳解析 `evidence.primaryAnalysis.analysisId → research_analysis.runId`，且可能提不出 id（维护层已设 `unattributed` 计数并**绝不删**）；❌ **F 级联删除会毁桥** —— `deleteExperimentCascade` **连 candidate 一起删** ⇒ 若溯源只存 Research 侧，清理研究即永久失去溯源；⚠️ C Result 缺结构化 Dataset/Config/Horizon/filter 上下文且**无指纹、无版本号**。⇒ **结论：Research 有数据资格、无「唯一溯源载体」资格 ⇒ 溯源快照必须写到 Strategy 侧**。**五、方案裁定**：比较方案 A（`Conclusion→Draft→Version`）/ B（`Candidate→Draft→Version` 四层）/ C（`Candidate` 即 Draft，确认后直接建 Version），**推荐 C**。硬理由：① 它是唯一**不新增领域对象**的方案（表 + 状态机 + 契约全部已存在，见二）；② A/B 会让「Draft」**同时是对象与状态**，与 C-21.1 八态**撞名**（`STRATEGY_LIFECYCLE_STATUSES` 已含 `Candidate` 与 `Draft` 两态）；③ A/B 的 Draft 表若承载可执行定义 ⇒ **第二 Canonical SoT**（§25 禁止 4）；④ **Candidate 的规则草图与 Strategy Definition 是两套不可能同构的词表**（`ResearchEntryRule{event:string}` vs `entry.event.type ∈ {FIRST_LIMIT_UP,…}` + 字段时间域目录 + Look-Ahead 8 规则 L1–L8）⇒ 强转需**显式转换器**，而转换器正好该放在 promote 服务里；⑤ Candidate 对 Canonical 零污染、对 Backtest 零耦合。**六、溯源设计（指令 §7/§8）**：**不全存四个 id** —— 落列只留「无法廉价回查」或「会随上游消失」的量：✅ `sourceConclusionId`（桥的唯一入口）、✅ **`sourceResearchRunId`（唯一无法列级反查的量，可空 = 如实承认提不出）**、✅ `sourceExperimentId`、✅ `sourceDatasetVersionId`（**快照**，从 experiment 复制）；❌ **不存 `resultId`**（Result 可变，存 = 存一个会失效的锚点）；⚠️ `analysisId` 不列化（一个结论**可引用多个** analysis，列化即退化成「只留第一个」，故入 `sourceTraceJson`）。**七、Dataset 坐标（指令 §8/§9）**：`datasetVersionId = dataset_version.id` **唯一口径不变**；明确区分 **Research Source Dataset**（`candidate.sourceDatasetVersionId` 快照）与 **Strategy Execution Dataset**（`strategy_versions.datasetVersionId`）⇒ **允许不同**（缺省继承；不同须显式 `overrides.datasetBinding` + `datasetDivergenceReason` 并显著提示），**禁止**因不同就强制一致、**禁止**因不同就改写研究来源坐标。**八、数据库逻辑设计（不含 DDL）**：① `research_strategy_candidate` **仅增 4 列**（`sourceDatasetVersionId` / `sourceResearchRunId` / `sourceTraceJson` / `sourceDatasetDivergenceReason`；**不加**同 `conclusionId` 唯一约束 —— 明确**允许一个结论产多份候选**）；② **新增 1 表** `strategy_research_provenance`（PK id；`UNIQUE(strategyVersionId)`；`source*` 全为**快照值非 FK**；`origin = DIRECT|INHERITED`；**零外键**）；③ **不动** `strategy_versions` / 投影表 / `StrategyDocument` / `StrategyVersionRecord`（**不递增 recordVersion** ⇒ 指纹与既有版本零影响）；④ 不建 `strategy_drafts`。**九、防循环依赖（指令 §16）**：新增**唯一桥** `server/research/strategyCandidate/`（`types` / `definitionBuild`（**唯一显式转换器**）/ `service` / `provenance` / `index`），铁律「`researchCore` **禁** import `strategySchema|strategyPersistence`；`strategyPersistence` **禁** import `researchCore`」；**唯一例外** = `StrategyService` 接受**可选注入端口** `StrategyProvenancePort`（与既有 `datasetRegistry: DatasetVersionReferencePort` 注入**同风格**，缺省 no-op ⇒ 不构成反向依赖），供 `cloneVersion` 继承 provenance；建议 006.1 一并落地 `importBoundary.test.ts` 把「靠人守」变成「靠测试守」。**十、API 设计**：**保留**既有 `researchEngine.listCandidates`（**不为好看搬路由**，前端已接）；新增 `get`(public) / `createFromConclusion`(admin) / `update`(admin，**白名单摘除 `status`**) / `transition`(admin，🔴 **`CONVERTED` 一律拒绝**，必须走 promote) / **`promote`(admin，唯一能写 `CONVERTED` 与 provenance 的入口)**。`createFromConclusion` **不接受 `datasetVersionId` 入参**（来源坐标恒取 experiment，防研究来源被改写）+ 7 步校验链（Conclusion 存在 → Experiment 有效 → 坐标有效 → **Dataset Version 存在 ∧ READY**（复用既有 `datasetBindingValidation` 只读端口，**不写第二套 SQL**）→ `status ∈ {DRAFT,FINAL}` → 同 conclusion+name 冲突 → 既有 `assertCandidateInput`/`assertConditionSet`）。`promote` 8 步强制顺序：ACCEPTED 断言 → **幂等闸门**（已有 `strategyDefinitionId` 或 provenance 已有该候选行 ⇒ 返回既有 strategyId）→ build definition → validate(L1–L8) → Registry 校验 → `StrategyService.create`+`createVersion` → **同事务写 provenance** → 回写 candidate(`CONVERTED`)。🔴 **诚实登记跨存储事务缺口**：⑥⑦ 在 Strategy 事务、⑧ 在 Research 库，**两次写非原子** ⇒ ⑧ 失败抛 `PROMOTE_WRITEBACK_FAILED` 并带上已生成的 `strategyId`，由**幂等闸门**保证重试**不产生第二份 Strategy**。**初始版本状态** = `Draft`（缺省）/ `Research`（显式），**只能取 `STRATEGY_LIFECYCLE_GENESIS_STATUSES` 白名单**，版本号建议 `1.0.0`。**十一、状态机**：Candidate **沿用既有六态不改**，但补两条纪律（不新增状态）：🔴 `CONVERTED` 只能由 promote 到达；🔴 `update` 白名单必须摘除 `status`。Strategy Version **复用 C-21.1 八态，明确拒绝**指令 §12 建议的 `DRAFT/VALIDATED/PUBLISHED/ARCHIVED` 四态（与八态重叠且更窄 ⇒ 两套状态真相）。**十二、删除策略**：Research = provenance（**快照值**）/ Strategy = independent artifact ⇒ **`deleteExperimentCascade` 的既有行为保持不动**，Strategy 侧靠**快照而非 FK** 独立存活；**不需要** `SOURCE_DELETED` 状态列（来源存活由**读取时探测**如实标注）；provenance 随 `deleteStrategy` **显式同事务删除**；因**零外键**，`sourceDatasetVersionId` 悬空时由应用层如实标注「来源数据集版本已不存在」（与项目「绝不自动修复漂移」同纪律）。**十三、首板回踩设计级示例**：结论（首板后 1~5 日回踩不破首板日开盘价）→ Candidate（`entryRule{event:"FIRST_LIMIT_UP"}` + `filterRule{bar.low >= prefix.rd0.open}` + **`exitRuleJson: {}` 刻意留空** + `parameterSpace{holdGuardDay: 1..5}`）→ promote → StrategyDefinition（`entry.event.type=FIRST_LIMIT_UP` / 窗 `1..5 TRADING_DAY` / `conditions[0] = {field:"bar.low", op:GREATER_THAN_OR_EQUAL, valueType:FIELD_REFERENCE, value:"prefix.rd0.open"}` / `parameters[0].parameterRole=TUNNABLE` / `datasets[PRIMARY]=390002 v2`）。🔴 两个要点：**「首板日开盘价」必须写 `prefix.rd0.open` 而非 `event.open`**（T 日 OHLCV 在 `prefix.rd=0`，`event` 表**无 OHLCV 列** —— 写错被 Look-Ahead 拦为 `UNKNOWN_FIELD_REFERENCE`）；**Research 只能给候选规则，不得把「最佳参数/最佳收益」固化成正式规则**（故出场留空、持有天数入 `TUNABLE`，参数化归 Parameter Search）。**十四、产出与边界**：唯一产物 `docs/research/RESEARCH-006.0-architecture.md`（16 节 + Q1–Q10 结论表 + 审计证据清单），**不含任何 migration / 业务代码改动**；**未修**审计中发现的 B1~B6 与 §4.2 A~F 任何缺陷（**只登记**）。**十五、编号撞车（登记，需裁定）**：§47 已用 `RESEARCH-006/007/008`（9m/9n/9o）指代**结果页可读性前端任务**，与本架构线**同名不同物** ⇒ 本 STEP 一律带 `.0/.1/…` 子号，后续若继续架构线建议在 §47 统一加「架构线」前缀，避免两条线互相冒充。**十六、下一 STEP**：`RESEARCH-006.1`（数据库 + Domain Model：candidate 增 4 列 + `strategy_research_provenance` 新表 + migration/幂等 apply + 断言 + `importBoundary.test.ts`）⇒ `006.2`（Conclusion → Candidate Service + 读端点）⇒ `006.3`（Candidate → Strategy promote + definitionBuild + provenance + clone 继承）⇒ `006.4`（API 收口 + 前端）⇒ `006.5`（真实 TiDB + 真实 tRPC + Regression）。**一次只实施一个 STEP，006.0 不提前开发 006.1~006.5。**

- **2026-09-12 19:00 GMT+8 — WORK RESEARCH-006.1（架构线）Research → Strategy Bridge：数据库 + Domain Model（migration 实落真实 TiDB；零数据变化）**。用户指令 30 节规格，**唯一架构基准 = `docs/research/RESEARCH-006.0-architecture.md`**。**一、交付范围 = 只建桥，不接线路**：完成 `research_strategy_candidate` +4 列、新表 `strategy_research_provenance`、Candidate 4 字段双仓储、Provenance 领域类型 + 仓储、依赖边界守护测试；**业务 API / promote / transition / 前端一律未做**。

  **二、真实库审计（动手前）**：新增只读探针 `_r0061_probe.mjs` → `_r0061_probe_result.md`。实查：全库 58 张表、**全库 FK = 0**、`research_strategy_candidate` 真实 **14 列 / 0 行**、5 个索引、**无 FK**；`strategy_research_provenance` **不存在**；`strategy_versions` **0 行**；`dataset_version` 2 行；12 张 `research_*` 表行数基线（`research_result` 674 / `research_conclusion` 7 / `research_analysis` 19 / `research_run` 8 / `research_experiment` 2…）。**结论：006.0 §13 的逻辑设计可以**原样**落 DDL，无任何需要先修的既有偏差。**

  **三、migration（手写 + 幂等 apply，遵项目约定）**：`drizzle/0036_research_strategy_bridge.sql`（6 语句，全带 `-- @guard: column|index|table <target>`）；`scripts/applyResearchStrategyBridge.mjs`（与 `applyStrategyDomainModel` / `applyStrategyDatasetBindingVersionId` 同一引擎与纪律，支持 apply / `--dry-run` / `--check`）。**未**用 `db:push` / `drizzle-kit generate`，**未**碰 `drizzle/meta/_journal.json`。**4 列全部 NULL-able ⇒ 零回填、零数据迁移**；表命名取**语义名** `research_strategy_bridge`（遵 §49「禁带 STEP 编号」）。

  **四、实查断言全 PASS（`information_schema`，不依赖 Drizzle schema）**：① `sourceDatasetVersionId` bigint/YES、`sourceResearchRunId` bigint/YES、`sourceTraceJson` longtext/YES、`sourceDatasetDivergenceReason` varchar(512)/YES —— 逐列类型 + nullable 断言 ✓；② Candidate 列序 = **基线 14 列 + 恰好这 4 列追加在后** ✓；③ `idx_research_candidate_source_dataset_version` ✓；④ provenance **13 列**逐列类型/nullable/`COLUMN_KEY` 断言 ✓（`id` PRI / `strategyVersionId` **UNI** / `strategyId`·`sourceCandidateId`·`sourceConclusionId` MUL）；⑤ `uq_strategy_research_provenance_version` **NON_UNIQUE=0 且列 = strategyVersionId** ✓；⑥ 另 3 索引列名逐一 ✓；⑦ **FK：Candidate 0 / Provenance 0 / 全库 0** ✓；⑧ **既有 12 张 `research_*` 表列签名逐列比对零意外变化** ✓；⑨ `strategy_versions` / `strategy_version_datasets` **无任何含 research 的列**（Canonical 零污染）✓；⑩ `--check` **PASS**（`failures = []`）✓；⑪ **二次 `apply` 幂等**：6 语句全 `skipped`、仍 PASS ✓。

  **五、行数守恒（apply 前后 20 张表逐表比对）**：`research_result` 674→674、`research_conclusion` 7→7、`research_run` 8→8、`research_analysis` 19→19、`research_analysis_condition` 11→11、`research_experiment` 2→2、`research_strategy_candidate` **0→0**、`strategy_research_provenance`（新建）**0**、`strategy_versions` 0→0、`strategy_version_datasets` 0→0、`dataset_version` 2→2、`dataset_definition` 1→1 ⇒ **`rowCounts.diff` 全 `changed=false`**。**这就同时证明了「migration 未自动产生任何 Candidate」与「既有研究数据零变化」。**

  **六、Domain Model（Candidate 4 字段的语义与不可变性）**：`sourceDatasetVersionId` = 「**基于哪份数据研究出来**」= `dataset_version.id` 快照，从 `research_experiment.datasetVersionId` **复制**，此后**不随上游变化**（上游该列本就「创建即冻结」）；**它 ≠** `strategy_versions.datasetVersionId`（「未来执行用哪份数据」）。`sourceResearchRunId` 解决 006.0 §4.2 E 的「列级无法反查」：`research_conclusion` **没有 `runId`**，只能 `evidenceJson.primaryAnalysis.analysisId → research_analysis.runId` **两跳**解析；**解析不出写 NULL，禁止伪造**（契约测试专门断言「提不出时保持 null」）。`sourceTraceJson` 是 **provenance 快照** —— 因为 `research_result` **不是 immutable**（`engine.ts:712-714` `deleteByAnalysis` 后 `createMany`，重算即替换），只有快照能让「当初凭什么」长期可回答；它**不是** Result 的第二份存储。`sourceDatasetDivergenceReason` 仅当 Research Source Dataset ≠ Strategy Execution Dataset 才允许非空，**一致时必须 NULL**（防「填了就显得严肃」的空话）。**读写双向完整**：`mapCandidate` 读 4 列（`sourceTraceJson` 走 `decodeJson`）、`create` 写 4 列（`encodeJson`）、`list` 新增 `sourceDatasetVersionId` 过滤；`inMemory.ts` 缺省归一为 `null`（不是 `undefined`），与 DB 语义逐项对齐。

  **七、Provenance 仓储（Strategy 侧独立切面，display-only）**：目录 `server/research/strategyCandidate/`（`types.ts` / `provenance.ts` / `provenanceContract.ts` / `index.ts`）。领域类型 `StrategyResearchProvenance`（13 字段）+ 枚举 `STRATEGY_RESEARCH_PROVENANCE_ORIGINS = [DIRECT, INHERITED]` + 错误码（`ALREADY_EXISTS` / `NOT_FOUND` / `INVALID_INPUT`）+ `assertProvenanceInput`（**只校入参形状，不校上游是否存在** —— 因为零 FK，来源存活只能读取时探测，这正是「快照而非 FK」的价值）。仓储能力：`create`（先查后插 + `ER_DUP_ENTRY` 兜底双保险）/ `getByStrategyVersionId` / `listByStrategyId`（升序）/ **`getBySourceCandidateId`（未来 `promote` 的幂等闸门：已产出过策略的候选不得再产第二份）** / `deleteByStrategyId`（**非级联**，由未来 `deleteStrategy` 应用层显式同事务调用）/ `deleteByStrategyVersionId`；**刻意不提供任何 update** —— 溯源是历史事实快照，可改即伪造历史。`DbStrategyResearchProvenanceRepository` 复用 `researchCore/serialization` 的 `encodeJson`/`decodeJson`/`toIso`（**不新造第二套 JSON 纪律**）；另有 `createInMemoryStrategyResearchProvenanceRepository` 作测试替身。**定位再强调**：它是 `Strategy Version` 的**兄弟切面**，不是 `strategy_versions` 的列、更不是 `StrategyDocument.definition` 的字段 ⇒ 不参与 definition / fingerprint / 5 投影 / validate / backtest / 参数搜索 / 模拟 / 执行。

  **八、⚠️ 契约唯一化 —— 「DB / InMemory 语义一致」是怎么被证明的（本轮方法论要点）**：把 15 条断言抽成**唯一一份** `provenanceContract.ts`（`runProvenanceContract` + `runCandidateSourceContract`，自带清理），由 **InMemory**（`provenance.test.ts`）与**真实 TiDB**（`scripts/verifyResearchStrategyBridge.mts`）**各驱动一遍**，并断言**两边用例名集合逐字相同**。若两边各写一套断言，通过只能说明「两套断言各自的实现没崩」，**不能**说明语义一致 —— 这是本轮刻意避免的伪证据。另在真实库上用**裸 SQL 独立证明** `UNIQUE(strategyVersionId)` 是真约束：先裸 SQL 插入哨兵行 → 再裸 SQL 重复插入 ⇒ **`ER_DUP_ENTRY`**（绕开应用层的「先查后插」，避免把应用层逻辑当成 DB 约束的证据），随后删除哨兵。脚本收尾断言 **50 项全 ✓ / 0 ✗**，且 20 张表行数**逐表守恒**（自建自清：候选与溯源行全部删除 ⇒ 回到 0）。

  **九、⚠️ 实施中发现的规则冲突与裁定（本 STEP 最重要的一条判断题，必须登记）**：006.1 §15 要求 `experimentId` / `conclusionId` / `strategyDefinitionId` / `status` / 4 个 `source*` **一律**不可经普通 Candidate update 修改。**实查后按 §1「发现冲突先报告、不自行重新设计」的原则处理**，冲突有两处：(a) `server/researchCore/repository/inMemory.test.ts`（**RESEARCH-001 既有验收**）**用 `update({status})` 显式走完 `DRAFT→REVIEW→ACCEPTED→CONVERTED`** 并断言「非法迁移被拒」与「CONVERTED 必须有 strategyDefinitionId」——把它们从**仓库层**摘出会**直接破坏既有基线**（违反 006.1 §26「测试结果与 baseline 可解释」与 §16「不要修改状态机」；按项目铁律**禁为过测试改期望**）；(b) **006.0 §10.1 已有明确分工裁定**：把 `status` 从「通用 update 白名单」摘出是 **API 层（006.2）** 的职责，仓库层保留状态机守卫路径。⇒ **裁定（本 STEP 落地）= 字段分两类，边界同样明确且不破坏基线**：**① 硬拒（结构锚 + 历史事实快照）**：`experimentId` / `conclusionId` / 4 个 `source*` —— 类型层用 `Pick<>` 排除 + 运行时 `assertCandidateUpdatePatchKeys` **响亮失败**（6 个字段逐项点名，契约测试与单测双重覆盖，**不静默忽略**）；**② 状态机守卫（不是放开，是只能按 `CANDIDATE_TRANSITIONS` 走）**：`status` / `strategyDefinitionId` —— 保留既有 `assertCandidateTransition` + `assertCandidateConversionCoherence`（**语义一字未改**），并**明文登记**：006.2 的 API 层必须再把它们从通用 update 白名单摘出，006.3 起 `CONVERTED` 只能由 `promote` 到达。裁定已写入 `researchCore/candidates.ts` 顶部注释、`repository/contract.ts` 的 `UpdatePatch` 文档、`drizzle/schema.ts` 的表注释**三处**，并用 `candidates.updateBoundary.test.ts` 的「两清单无交集」断言防止未来漂移。

  **十、边界守护（把「靠人守」变成「靠测试守」）**：新增 `server/research/strategyCandidate/importBoundary.test.ts`（6 例）。实现方式：**读源文件文本 + 正则解析 import 说明符**（只匹配真实 import 语句，**注释里提到模块名不算** —— 否则文档性引用会误伤），覆盖：`server/researchCore/**` **不** import `strategyPersistence|strategySchema` ✓；`server/research/strategyPersistence/**` **不** import `researchCore` ✓；`server/datasetRegistry/**` **不**反向依赖 `researchCore|strategyCandidate|strategySchema|strategyPersistence` ✓；**全 `server/**` 中只有桥目录可同时 import `researchCore` 与 `strategyPersistence`** ✓（当前桥只 import 前者，006.3 加 Strategy 依赖时该断言开始真正生效）；桥**不得被** Research Core / Strategy Persistence 反向 import ✓；桥**不得** import `server/research/index.ts`（STEP 6.x legacy 复数链路，与 researchCore **同名不同物**，引入会把两套 Research 语义混在一个文件里）✓。

  **十一、验收**：`npx tsc --noEmit` ⇒ **RC=0**（0 error）。聚焦（`server/researchCore` + `server/research/strategyCandidate` + `server/research/strategyPersistence` + `server/datasetRegistry`）⇒ **24 文件 / 421 例全过**。全量 `npx vitest run` ⇒ **220 文件 / 3490 例，15 失败 / 7 文件**，失败集合 = `dataHealth`(1) / `image.uploadAndRecognize`(1) / `limitUp`(1) / `limitUp.watch`(4) / `marketData`(4) / `tushare.secret`(1) / `tushareTradingCalendar`(3) ⇒ **与既有基线逐项一致、零新增失败**；新增 24 例全部通过；**禁为过测试改快照或期望**这一条未被触碰。真实库 `npx tsx scripts/verifyResearchStrategyBridge.mts` ⇒ **50 ✓ / 0 ✗ / `pass: true` / RC=0**（首次运行时脚本因 `getDb()` 连接池拖住 event loop 而「跑完不退」，已加显式 `process.exit` 收尾 —— 这是本轮一个值得记住的工具坑）。

  **十二、产物**：`docs/research/RESEARCH-006.1-implementation.md`（16 节：修改文件 / migration / 实际 TiDB schema / Candidate 新字段 / Provenance schema / 索引 UNIQUE FK 检查 / 行数前后对比 / Repository 测试 / Boundary Test / tsc / 聚焦测试 / 全量测试 / baseline 对比 / 未实施的 006.2~006.5 / **规则冲突裁定** / 证据清单）。证据文件：`_r0061_probe.mjs` + `_r0061_probe_result.md`（前状态只读审计）、`_r0061_apply.json`（首次 apply：6 executed / `pass=true`）、`_r0061_apply2.json`（幂等重放：6 skipped）、`_r0061_check.json`（`--check` PASS）、`_r0061_verify.log`（真实库领域层验收）、`_r0061_fulltest.log` / `_r0061_fulltest.clean.log`（全量测试）。

  **十三、§29「严禁偷跑」实查核对（以下必须仍不存在 ⇒ 已确认全部不存在）**：`research.strategyCandidate.createFromConclusion` / `promote` / `transition` / `get` 端点；Candidate 前端登记按钮与编辑流程；Strategy Provenance UI；Research → Strategy 自动转换；Strategy Version 自动生成（`strategy_versions` 仍 **0 行**）；`strategy_drafts` 表；Candidate 新状态值（六态不变）；`StrategyService` 行为改动；`candidates.create` 的业务调用点（**仍为 0 处**，仅契约测试自建自清）。**下一 STEP = `RESEARCH-006.2`（Research Conclusion → Candidate Service）**：`createStrategyCandidateFromConclusion` 七步校验链 + `get`（含 experiment/conclusion/dataset label 解析）+ `update`（**API 层摘除 `status`**）+ `transition`（**拒绝 `CONVERTED`**）+ 注册新 router（**保留**既有 `researchEngine.listCandidates` 不动）；**不实现 promote、不写任何 `strategy_*` 表、不做前端**。**一次只实施一个 STEP。**

- **2026-09-12 19:35 GMT+8 — WORK RESEARCH-009（分析建设线）把「回撤分档 × 建仓后四口径」与「多候选日回撤触发」建成正式分析（新建 Run 480001；纯建分析 + 整轮执行，零后端改动 / 零迁移 / 零新端点）**。触发 = 用户「**把这些都建成分析**」（承接上一轮只读探针给出的四口径表与「多候选日」近似方案）。

  **一、挂载点选择（为什么新建 Run 而不是增量补跑）**：复用 Experiment `240002`（`datasetVersionId = 390002`，即被核查过的 v2），**新建 Run `480001`（runNo = 5）**。两条理由：① `runIncremental` **不生成结论**（只有 `run()` 整轮才走 ConclusionBuilder），而「结论」是用户读结果的主入口；② 这批新分析是一个**自洽的研究批次**，混进既有 `450001` 会与 `390001~390005` 的语境纠缠。可比性不受影响（同 experiment ⇒ 同 `datasetVersionId`）。执行前脚本内置守卫：**检测到 RUNNING 的 Run 即拒绝启动**（并发写状态铁律）。

  **二、建了什么（7 个分析，`createAnalysesBatch` 预检整批通过、执行期失败 0）**：**A 组 4 个 `SEGMENT_RELATION`**（窗 A 固定 = `max_drawdown` `[0,5]` = 复用既有 `max_drawdown_5d`，分 **5 档**；**只换窗 B 口径**，窗 B 固定 `[5,20]`）—— `420001` `windowBStat=return`（`segment_return_5_20d`，期末收益）/ `420002` `max_return`（`segment_max_return_5_20d`，最大有利偏移）/ `420003` `min_return`（最大不利偏移）/ `420004` `max_drawdown`（最深跌幅）；**B 组 3 个 `CONDITIONAL`**（`420005/420006/420007`，条件 = `pullback_from_event_high_{h}d <= −0.08`、target = `segment_return_{h}_20d`，h = 2 / 3 / 5）—— 这是「**回撤触发式建仓**」在**现有能力内**的近似（固定候选日 × 阈值条件）；真正「首次触发日因样本而异」仍需新变量族 + 新分析类型（见 §44.5 缺口登记）。**口径唯一性**：建分析走产品自己的领域层（`createAnalysesBatch` + `ResearchEngine`），**没有第二套口径**；B 组的条件字段是已登记的 OUTCOME 变量（`conditional.ts:85-88` 明确允许「用结果变量做条件」并会显式登记装载）。

  **三、执行（真实库整轮）**：`sampleCount` = **23,978**；7 分析全 `COMPLETED`；结果行 **167**；`conclusionId = 360001` / `conclusionType = SUPPORTED`；**装配 43.3 s / 总 64.3 s**（PERF-IMPL-001 之后的量级，未再出现 9 分钟级装配）。

  **四、关键数字（落库读回，档 1 = T..T+5 跌幅最深、档 5 = 最浅）**：**A 组期末收益** mean = 档1 **+0.194%** / 档2 **+0.416%** / 档3 −0.038% / 档4 −0.076% / 档5 **−1.608%**，`SPREAD_TOP_BOTTOM`（末档 − 首档）**−1.802%**、`p ≈ 5.6e-6`；**A2 最大有利偏移**均值 13.75% → **16.56%（档 5 最高）**；**A3 最大不利偏移** −11.23% → **−13.93%**；**A4 最深跌幅** −9.00% → **−11.72%** —— 三者**同向**，即「越不跌就买」的那批**建仓后上下都更大**。⇒ 「等回撤再买」的价值主要在**少亏**（不利偏移收窄 ≈ 2.7pp），而不是多赚（收益侧区分度仅 0.4~2pp 且**非单调**，档 2 优于档 1）。**B 组** `DIFFERENCE`（条件组 − 全样本）= h=2 **−0.965pp（n=3,151）** / h=3 **+0.242pp（n=4,319）** / h=5 **+0.551pp（n=5,988）** ⇒ **触发时点本身就是信息**：T+2 就深跌 8% 多为承接极差（之后更弱），越晚才跌到 −8% 越像温和回踩（之后反而修复）。⚠️ 三组 `ALL` 均值分母不同（22,958 / 22,951 / 22,944），因为各 target 的取值窗不同（`segment_return_h_20d` 需 T+h..T+20 齐备）。

  **五、🔴 本轮暴露的两个「呈现会读错」问题（已登记、**刻意未修**）**：**(a) 引擎侧口径判断不全**：`analyses/segmentRelation.ts:124` 只对 `windowB.stat === "max_drawdown"` 屏蔽 `WIN_RATE`（注释理由：『> 0 占比』不是胜率），但 `max_return` / `min_return` **同样没有交易含义**（同样是「极值 > 0 的占比」）—— 实测 A2 胜率 **94.5%**、A3 **2.7%**，列出来只会诱导误读；**(b) 前端指标标签不感知目标变量口径**：`METRIC_LABELS` 的 `MEAN_RETURN` / `MEDIAN_RETURN` / `WIN_RATE` 是**静态**中文名（「平均收益 / 收益中位数 / 胜率」）⇒ A2 的「**平均最大有利偏移 +13.75%**」在页面上会显示成「**平均收益 +13.75%**」。

  **六、零改动的边界（刻意的）**：**未改任何 `server/**` 与 `client/**` 源文件**，未新增依赖、未迁移、未碰 `ds_*` 与 dataset 页面、未改任何分析口径与涨停判定。不修第 5 节两点的原因：两者都要改代码，而改 `server/**` 会热重启 dev server 并**杀死在途研究 Run**（2026-09-11 运行纪律）⇒ 必须挑不在页面上操作的时段单独排（§44.5 9r / 9s）。

  **七、证据**：一次性脚本 `scripts/_oneoff_createPullbackAnalyses.mts`（建分析 + 执行 + 回读）与 `scripts/_oneoff_inspectResearch.mts`（动手前的只读现状探针）**均已删除**；数字全部来自落库结果行（`research_result`，按 `analysisId` 读回）。**未做**：前端实机截图（本机 `agent-browser` 不可用，见 `PROJECT_RULES.md`）。

## 49.1 规则（强制，面向新增/修改代码）
1. **代码模块目录名禁止携带 STEP/C-task 编号或任何数字后缀**（robustness18、signal13 之类一律禁止）；使用纯语义小驼峰（camelCase），如：`signalEngine`、`costModel`、`executionConstraints`、`riskAdjustedMetrics`、`tradeQualityMetrics`、`parameterSearch`、`rollingOptimization`、`robustness`、`stochasticRobustness`、`walkForwardRun`、`oosIsolation`、`overfittingDetection`、`lifecycle`、`marketRegime`、`paperAccount`、`signalToPnl`、`researchDataset`、`datasetAccess`、`simulator`、`strategySchema`。
2. **模块文件（含 .test.ts）同样禁止携带任务编号**；测试文件与模块同主体：`<module>.test.ts`（如 `robustness.test.ts`）。
3. **STEP/C-task ↔ 模块映射由以下渠道承载，目录名不得重复承载**：目录头注释（`/** STEP xx / C-xx.y — … */`）、`server/research/index.ts` 统一出口注释、ROADMAP §44/§47 与 TASK_TRACKING 记录。
4. 例外（不受限）：`docs/` 下证据与日志产物（日期戳文件名、gate json 如 `research_ready_gate.json`）；`scripts/` 工具文件名；数据回填 CLI 参数。
5. 禁止为规避本规则引入编号/数字变形（如 `wfo2`、`copy3`）；名称必须取自职责语义。命名前先全库查重目录名与顶层符号（教训：`DEFAULT_LOT_SIZE` 重复导出 TS2308、`PaperPosition` 被 legacy 占用）。

## 49.2 历史追溯
2026-09-07 21:45 前的带编号目录名（signal13/costModel14/…/docs/step12-evidence）出现在 §47、TASK_TRACKING §5、memory 等 append-only 记录中，**不追溯改写**；以本节日期对应 §47 改名记录为映射对照（旧名 → 新名）。新增代码一律遵守 §49.1。
