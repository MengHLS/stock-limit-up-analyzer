# 项目现状、最新研究与下一步建议（2026-10-10）

## 1. 结论与范围

**建议下一项只做：Event-State Long 的研究配置、不可变策略版本和正式运行入口的一致性收口。完成后，再验证它是否具有超出现金与低市场暴露的经济价值。**

现有证据支持把 `maxAmp5` 保留为值得验证的研究候选；不支持将 `3600006` 直接作为已验证的可交易资产。T+15 失败过滤、LONG-4 扩宽、三尺度综合评分和旧 t74 的局部调参，均不应成为当前主线。

- 审计对象：HEAD `f8b6810` 加当前未提交工作区；架构基线 `v2.7.0`。最新研究多数为未跟踪文件，不能仅靠 HEAD 复现。
- 范围：架构基线、执行入口、近期研究汇总与关键过程报告、对应本地 harness、真实库只读查询、正式配方和装配函数的只读复现。不是全仓逐行代码审计，也未重新执行全量历史回测。
- 证据分级：**本次实测**（库 / 代码 / 探针）与**历史报告数值**分开；报告原有 PASS、Alpha、可交易等词不自动等同本次判断。
- 本次没有修改业务代码、策略版本或数据库，没有创建 Run、Candidate、账户或新研究实验。

## 2. 平台整体判断

| 层 | 已有能力与证据 | 当前判断 |
|---|---|---|
| 数据 | Dataset Registry、版本坐标、事件五表、构建与恢复；780004 / 780005 实查 READY | 足以继续有边界的策略验证；数据集之间不可仅凭名称混用 |
| 研究 | 独立实验注册、分页取数、PIT、样本账、产物存储、预注册规范；已积累大量否定性结论 | 能力丰富；近期关键成果仍大量停留在临时脚本、报告和本机产物 |
| 策略 | Strategy Core、不可变版本、特征注册、文档和执行投影 | 基础边界明确，但最新版本的声明与被测配置没有闭合 |
| 回测与验证 | 正式装配、流式模拟、canonicalMetrics、持久化 OOS/WFA/Robustness 路径均存在 | 基础设施已具备；具体研究是否真的经过这些入口必须逐项证明 |
| 前端 | `/research-experiments`、策略详情、回测留档、`/validation/*` 等入口存在 | 本次只核代码入口，未做页面交互验收；最有价值的下一项是准确呈现证据与阻塞 |
| 模拟 / 生产 | 有历史纸面交易能力；Production 仍为规划状态 | 不能从某模块 ACTIVE 推导最新策略具备前向运行资格 |

执行链需区分入口：`closedLoopWiring/executors.ts#buildExecutor` 的非流式链含 optimization/regime；`createStreamingClosedLoopWiring` 只装配 data/research/strategy/backtest/evaluation；finalize 在 `closedLoop/orchestrator.ts#runClosedLoop` 中有内置生命周期路径。未接线阶段继续如实 BLOCKED。

**本次 DB 快照：**14 个 dataset version；179 个 strategy version（Draft 144、Research 32、Retired 1、Validated 2）；独立实验 48 种、165 条 Run（完成 132、失败 17、RUNNING 16）；闭环留档 463 条。16 条 RUNNING 中最近一条仍停在 9 月 25 日更新时间，属于需要核查的长期未收敛状态，不能未经运行器核实就认定仍在执行或直接改成失败。

上述数量是资产规模，不是验证通过的策略数量。此次查询的旧 `paper_trading_runs` 四个 active 账户最后处理日均为 9 月 30 日；该表不代表全部 Paper 子系统，本次不据此断言全平台纸面任务停摆。

## 3. 最新研究应怎样取舍

| 研究线 | 当前证据 | 下一步判断 |
|---|---|---|
| 旧 3F / t74 | 留档约 +151.10%，但回撤约 43.30%；收益高度依赖少数赢家；连续化并未解决问题；低振幅均值排序与抓右尾目标不一致 | 保留为历史对照，停止围绕旧高收益数字继续局部搜索 |
| LONG-4 | 具备池内相对排序信息；利用率研究五档全部跑输同期沪深300，扩大宽度会稀释选择收益 | 保留排序研究资产，不继续 TopN 扩宽 |
| MEDIUM | 相对随机池显著减亏，但报告净收益 −5.58%、CAGR −0.82% | 不能因相对优势显著就转为独立多头策略 |
| SHORT | `preReturn10`、`limitGap` 有广度层信息；冻结汇总披露 T+5 九组净收益均负；池内买点研究存在反向结果 | 不与 LONG 强行综合评分；暂不启动新组合 |
| Event-State Long | rd11–15 低振幅、rd15 决策、Top3、Hold40；修正随机对照后有选择能力；`maxAmp5` 与 `avgAmp5` 相关约 0.899 | 作为唯一优先候选保留；两个振幅变量不能当成两条独立 Alpha |
| 10 月 9 日后续验证 | 780005 上 Stage 1 FAIL；之后容量 / 执行 / Paper 阶段未启动 | 保留原 FAIL，不以换门槛方式追认通过 |
| 10 月 10 日 T+15 失败路径 | 总体上高振幅、阶段大涨等与较差后续收益相关；现有 Top3 已避开大部分该类事件；深回撤过滤反而伤害收益 | 收口为机制解释与观察变量；不新增过滤器 |

资料：`RESULT-151PCT-WINNER-CONCENTRATION-001`、`RESULT-LONG4-UTILIZATION-BENCHMARK-001`、`RESULT-MEDIUM-REAL-001`、`RESULT-FACTOR-TIMESCALE-FINAL-001`、`RESULT-POST-EVENT-STATE-NB-RANDOM-002`、`RESULT-POST-EVENT-STATE-LONG-ORTHOGONALITY-001`。

### Event-State Long 的两组关键历史数值

| 历史报告区间 | 策略收益 | 沪深300收益 | 策略最大回撤 | 基准最大回撤 | 证据性质 |
|---|---:|---:|---:|---:|---|
| 2019-01-03～2026-01-28，780004 | +53.88% | +59.13% | −18.08% | −45.60% | 研究脚本调用平台引擎；因子发现使用过区间，非严格未见样本 |
| 2026-01-29～2026-10-09，780005 | −7.54% | −9.18% | −13.33% | −14.81% | 后续验证报告：165 交易点、468 笔；发现边界独立性仍是显式假定 |

来源：`RESULT-TRADABLE-STRATEGY-FINAL-001` 与其后 `RESULT-VALIDATION-FINAL-001`。这些是报告记录值，本次没有重跑确认其数值。

**后面的 FAIL 必须覆盖前面“已形成可交易策略”的当前决策含义。**两份报告是先后阶段的结果，不是任选一份乐观结论使用。

## 4. 本次发现的首要阻塞：被测配置不等于存储策略

### 4.1 正式装配真实拒绝

只读取得 `strategy_versions.id=3600006` 的实际文档，分别调用：

1. `server/research/recipeRegistry.ts#resolveStrategyRecipe`
2. `server/runWorkbenchAssembly/assemble.ts#assembleStrategySide`

两者均抛 **`RECIPE_NOT_REGISTERED`**。文档声明 `recipeId=event-state-long-amp5-top3`，当前注册表没有该配方。

`maxAmp5` 已注册到 Strategy Core 特征表，并不意味着引用它的 recipe 已注册。`requireRecipe` 在正式装配里先解析文档配方，当前版本因此不能完成这一步。本次没有发起真实回测或写入运行留档。

### 4.2 即使补配方，也还有配置差异

| 项 | 存储版本 3600006 / 当前装配映射 | 最近研究脚本 |
|---|---|---|
| 仓位 | `EQUAL_WEIGHT` → `EQUAL_WEIGHT_CASH_BUDGET` | `FIXED_RATIO`、初始资本 × 1/180 |
| 候选退出 | 文档缺 `candidateExitPolicy`；装配默认 `HOLD_WHILE_SELECTED` | 显式 `DISABLED` |
| 观察与执行数据覆盖 | 文档观察窗 `{15,15}` | cursor `{15,79}`，另用 `decisionMemberPredicate` 限定只在 rd15 决策 |
| 决策实现 | 正式入口预期使用装配后的 Strategy Core 链 | `stage1run.ts` 手工构造 `amp5` provider、加权信号与模拟配置 |

前两项已通过生产映射函数和实际文档核实；数据覆盖差异已通过代码与脚本核实，尚未跑完整装配后的交易对拍。后续不能靠扩大策略决策窗口来掩盖执行行情不足，必须分别保留 PIT 决策边界和持仓期行情覆盖。

### 4.3 证据链与状态

- DB 状态仍为 `Validated`；研究最新裁定为 `RESEARCH_CANDIDATE`。前者是存储生命周期值，后者是研究判定，两者目前未形成可供用户理解的一致状态。
- 查询 `strategy_research_provenance WHERE strategyVersionId=3600006`：**0 行**。
- 查询 `closed_loop_backtest_run WHERE strategyId='event-state-long-maxamp5-top3'`：**0 行**。
- `codeVersion=1.0.0+gunknown`；文档指纹为 `7e863012181ff0e9a85a0e257b0b4d2a66a447acf16386e287f4fb22666a1cba`。
- 最新独立实验持久化 Run 日期止于 10 月 7 日。10 月 8–10 日关键研究主要见报告和临时脚本，不能当作已留档正式 Run。

这不等于研究从未计算，也不否定其发现；它说明“研究发现 → 版本声明 → 正式执行 → 证据留档”之间尚有缺口。

## 5. 研究解释还需要收紧的地方

### 5.1 指标存在第二套口径

`scripts/_scratch/stage1run.ts#met` 与 `stage3run.ts#met` 使用 `CAGR / annualizedVol` 当 Sharpe，并以 365.25 / 自然日跨度算 CAGR。Stage 1 的 Sortino 分母只对负收益日取均值。

项目权威实现：

- `shared/quant-stats.ts#sharpeRatio`：日收益算术均值 / 样本标准差 × √252。
- `server/research/riskAdjustedMetrics/analyze.ts#computeSortinoRatio`：下行偏差分母使用全部收益观察数。
- `server/backtest/backtestResult.ts#canonicalMetrics` 及共享年化函数：252 交易日口径。

因此，旧报告的 Sharpe / Sortino / CAGR / Calmar 不能直接当作 canonical 指标比较。总收益为负这一事实不因上述公式差异自动转正，**原 Stage 1 FAIL 仍应保留**。后续基于同一日权益重算并另存新核验结果，不覆盖历史 Run。

### 5.2 “低 Beta 防御”仍是待检验解释

- 下跌月 5/5 跑赢，是该区间内的描述性事实；其中包括不完整的首尾月份，不能等价为跨完整熊市稳定性已证明。
- 报告同页给出 Beta 0.308、年化回归 Alpha −7.39%。低 Beta 可解释市场暴露较小，**无法单独解释负的回归截距，也不能据此排除实现问题**。
- 历史阶段测过的是原始主动收益 t 值，不等于回归 Alpha 截距的显著性检验；“跟踪误差抵消 Alpha”也不是恰当的因果分解。
- 因子发现用过 2019–2025，原 S3 留出段也被用于两 Variant 的主策略选择。滚动切片仍有诊断价值，但不能恢复未见样本的地位。780005 的独立性边界未获完整研究历史证据支持，仍须保持限定。

外部方法核对：[Bailey 等，Statistical Overfitting and Backtest Performance](https://www.davidhbailey.com/dhbpapers/overfitting.pdf) 说明反复试验与选择会增加过拟合风险，单次划分 holdout 不能控制所有探索次数。本项目的具体独立性判断仍以自己的研究记录为依据。

### 5.3 T+15 新研究有价值，但不应夸大 Overlay 的证明强度

最稳的发现是：高振幅标记与现有 Top3 重叠仅 **2/4,908**，可用过滤空间极小；深回撤不是稳定的失败方向。

报告 Overlay 使用独立重实现：基线 **+57.79% / 4,701 笔**，平台引擎研究基线 **+53.88% / 4,811 笔**；存在整手、成交可行性预筛、出场时点等差异。过滤器 +0.23 / +0.24pp 是同一研究引擎内的差值。共同使用一个引擎有助可比，但**不能保证执行偏差与 Filter 不发生交互**，不能作为正式策略增益证明。现有证据已足以不采用过滤器，无需为几十分之一个百分点再开一轮搜索。

另外，J4 为追加项；J3/J4 的逐年负向为 6/7，而非所有标记均为 7/7。使用报告详细表的限定，不沿用更强的总括措辞。

### 5.4 容量与成本尚不支持“可交易性已确认”

“1～10 亿元”来自事件池成交额中位数除以单笔预算，缺少实际所选股票逐笔参与率、开盘可用流动性、退出冲击及压力场景。它是粗略量级估计，不是已验证容量。

研究成本设 `stampDutyRate=0`、`transferFeeRate=0`、`minCommission=0`。20/40bps 平坦成本敏感性有价值，但不能替代真实账户费率、整手、拒单与成交冲击。先按实际计划资金规模验证，再讨论容量上限。

## 6. 推荐的下一项任务：先把一条链做实

**建议任务名：Event-State Long 正式执行一致性收口。**目的为证明“平台执行的就是已冻结、已研究的定义”，不以提高回测收益作为验收目标。

1. **冻结比较对象。**列明 3600006 存储文档、780004/780005、研究脚本配置、代码提交与工作区差异摘要；保留旧版本和原失败结论。
2. **确认定义差异并通过新版本表达。**仓位、候选退出等内容差异经明确裁定后走 `applyDefinitionChange()`，不能原地改 3600006。配方和特征复用 Strategy Core，不引入新的 legacy 执行路径。
3. **用正式装配入口做有界验证。**覆盖 rd15 决策、次日开盘、不可成交、退出顺延、事件窗末端、整手、同股票重复事件、已有仓位。不要再只在 harness 手工拼一套 config。
4. **逐层对拍。**候选身份与分数 → 入选顺序 → 下单与拒单 → 成交日期/价格/数量/费用 → 日现金/持仓/权益。每处差异有原因，不能只对一个 TOTAL。
5. **统一指标与留档。**用 canonicalMetrics 和现有风险指标实现；记录真实代码版本、配置摘要、成交与权益摘要；经既有授权入口新增正式 Run / provenance。现有研究结果保留，不伪装成之前已经落库。
6. **使用户入口呈现最新证据。**显示“研究候选、后续验证 FAIL、正式执行核验进度”，防止只看到历史 `Validated`。生命周期字段如需变更，先确认合法迁移，不擅自造新状态或改库。

**验收终点：**从存储版本经正式入口可装配和执行；决策/交易/日权益可复现；口径差异全部解释；指标只有权威口径；证据可跨机器重建；最新研究状态可见。即使净收益不好，也可以通过工程一致性验收；投资资格单独判断。

最小实现边界预计涉及 `research/recipeRegistry`、`strategyCore` 既有特征适配、`runWorkbenchAssembly`、Dataset 执行行情覆盖与现有留档桥；具体 scope 以差异确认结果为准。**不需要**新建第二套回测引擎、修改历史 migration 或扩建整个平台。

## 7. 之后再做的一项经济验证

一致性完成后，优先回答：**maxAmp5 的防御价值是否超过简单降低市场暴露？**

已有 `NB-RANDOM-002` 已回答旧样本池内选择问题，不重复其 2019–2025 随机对照。新验证应聚焦后续验证段及前向未见数据：

- 保持当前因子 / Top3 / Hold40 固定；沪深300作背景对照，加入按事前规则确定的市场持仓加现金对照，及同候选池、同执行约束的对照。
- 同时检查仓位与风险匹配，区分现金、低 Beta、选股、费用与退出差异；Beta / 波动缩放参数只能由验证日前的数据估计，不能用全段结果事后配平。
- 报告净值、最大回撤、下行风险、真实费用、回归 Alpha 的置信区间；利用现有 HAC / 日期区块方法处理持仓重叠。不能以数千笔交易代替有效独立样本数。
- 780005 已经被看过；新增对照属于事后诊断，不得再称全新 OOS。真正验证集需要可证明未参与决策的历史样本，或从冻结日起积累的前向样本。
- 若没有相对简单对照的增量，收口为研究观察变量；若证据支持增量，再按新预注册协议开展前向观察。不要先放宽旧门槛再宣布原任务通过。

依据：[CFA Institute，Portfolio Risk and Return: Part II](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/portfolio-risk-return-part-2) 将系统性风险、Beta 与业绩评价分开处理。上述对照设计是针对本项目的建议，尚未执行。

## 8. 应暂停与应补齐

**暂停：**新一轮失败过滤阈值；maxAmp5/avgAmp5 组合；LONG×MEDIUM×SHORT 综合评分；t74 出场/止损/宽度重复搜索；在收益与正式执行尚未验证前做亿级容量优化；补满全部 14 阶段作为当前目标。

**补齐：**把必要 harness、冻结配置和产物索引转成可版本管理的复现资产，复用现有实验 / artifact 体系；更新唯一 ROADMAP 的当前状态，历史条目保留日期与被替代说明；单独核查长期 RUNNING 留档的运行器状态。提交时按数据、执行修复、研究结论区分，避免把所有未提交工作混成一次提交。

## 9. 检查与影响报告

- 类型：`pnpm run check`，exit 0。
- 受影响关键部件抽查：eventStateAmplitude、netPnlCaliber、positionSizingExecution、amplitudeOrientation，**4 文件 / 42 测试通过**。这是定点检查，不是全项目测试通过声明；本次未新增或修改测试。
- 只读运行探针：存储文档的正式配方解析与 `assembleStrategySide` 均复现 `RECIPE_NOT_REGISTERED`；无真实回测提交。
- 行尾：`node scripts/checkEolDrift.mjs --strict` **exit 1**；已跟踪文件漂移 **0**，唯一失败为开工前已有的未跟踪 `_scratch/overlap/probe01_db_state.mjs` 使用 CRLF。本次四份文档均为 LF，未修改无关会话探针。全仓行尾门禁不能报告为通过。
- 本次变更：本报告、SYSTEM-BASELINE 当前状态补充、ARCHITECTURE BD-14 事实修正、CHANGE-AUDIT。临时探针仅在 gitignore 的 `scripts/_scratch/`。
- Contract / DB / Execution impact：均为零；无业务代码或持久化状态写入，因此不能影响既有交易行为。报告只纠正文档对现状的解释。
- Baseline：增量事实修正，不宣布 Domain 跃迁，不提升架构版本；未改变模块边界或主链。已知差异的范围可以由具体入口限定，不需要以本次咨询为由启动全仓重构。
- 限制：未重跑历史全量回测；未做完整 UI、数据源真实性或全链所有分支审计；库可能被并发会话更新。下一步为上节给出的单条一致性任务，尚未实施策略语义变更。

本地复核脚本：`scripts/_scratch/projectReview20261010.cjs`、`projectReview20261010-runtime.mts`。关键查询结果、验证日志同前缀落盘；脚本不输出连接凭据。
