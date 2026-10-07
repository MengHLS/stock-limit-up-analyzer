# stock-limit-up-analyzer

个人 A 股量化策略研究平台的领域语言。研究链路：Dataset → Research → Strategy → Parameter Search → Backtest → Evaluation → Robustness/OOS/WFA → Paper Trading → Production。

## Language

### 数据集

**Dataset（数据集）**:
按固定的事件定义与相对日窗口物化出来的样本集合；一次构建固化一个版本，构建后语义不可后改。
_Avoid_: 行情数据、数据表、样本库

**DatasetVersion（数据集版本）**:
一个 Dataset 的不可变快照，是研究链路的输入坐标。
_Avoid_: 数据集名称、buildKey

**datasetVersionId**:
运行时唯一的数据集坐标。人读的版本 label 与内容寻址串只用于展示，不参与解析。
_Avoid_: datasetVersion 字符串、内容寻址串

**相对日（relativeDay）**:
相对事件日的整数偏移，事件日 = 0；rd≤0 是事实部分，rd≥1 是事件之后的部分。
_Avoid_: 窗口下标、offset、第 N 日

**PIT（Point-In-Time）**:
只使用判定日当时可得的信息来判定。未声明需要未来数据就读 rd≥1，会被直接拒绝而不是静默取数。
_Avoid_: 回看、后视、事后诸葛

**构建配置（BuildConfig）**:
一次 Dataset 构建所固化的筛选口径（标的全集与事件口径）；构建完成即冻结。
_Avoid_: 过滤器、参数

**decisionOffsetDays**:
每个数据集必须显式声明的、从事件日到判定日的偏移。缺失即响亮拒绝，不设默认值。
_Avoid_: 决策日、观察日、T+N

### 策略

**Strategy（策略）**:
一组可复现的入场/出场规则，外加它的版本化。
_Avoid_: 选股公式、信号、因子

**RuleGraph**:
策略语义的唯一权威表达。`server/strategyCore/**` 是它的唯一实现，legacy 结构只是存储编码。
_Avoid_: StrategyDefinition（当作语义来源时）、rule 配置

**StrategyVersion（策略版本）**:
策略内容的不可变版本，带语义化版本号与行为指纹；改内容只能产出新版本。
_Avoid_: 草稿、当前策略、最新策略

**StrategyDefinition（legacy 存储编码）**:
RuleGraph 的历史存储形式，只承担编码，不再是语义权威。
_Avoid_: 策略定义

**FIXED / TUNABLE / DERIVED**:
策略参数的三类角色：固定值、可调值、由其它参数派生。角色划分决定参数搜索能碰谁。
_Avoid_: 常量/变量/计算值

### 回测与评估

**Backtest（回测）**:
在某个 DatasetVersion 上按策略规则撮合、产出交易与权益曲线的过程。
_Avoid_: 模拟、仿真、跑数

**canonicalMetrics（规范指标）**:
回测指标的唯一定义与出口。下游评估在已有规范指标时不得重算重叠指标。
_Avoid_: 绩效指标、报表数字

**Run（运行）**:
一次真实执行的记录，是「实际运行结果」这一证据等级的来源。
_Avoid_: 任务、job、批次

**Paper Trading（模拟交易）**:
把已验证策略前向纸面执行的状态机；其账户状态与前向语义不可被重构悄悄改写。
_Avoid_: 实盘、模拟盘、虚拟盘

**equityDigest / tradeDigest**:
锁定已验证策略行为的两枚指纹（权益曲线与交易序列）；它们变化即代表行为变化。
_Avoid_: 哈希、校验和

### 研究流程

**Research（研究）**:
从一个 DatasetVersion 出发的探索：假设 → 实验 → 运行 → 结论 → 候选策略。
_Avoid_: 分析、统计

**Candidate（候选策略）**:
研究结论转正后的策略候选，是 Research 通往 Strategy 的唯一通道。
_Avoid_: 结论、finding、candidate strategy
