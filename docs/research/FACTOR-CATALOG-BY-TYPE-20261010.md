# 因子研究分类目录：单因子、多因子与策略规则

> 日期：2026-10-10；HEAD `f8b6810` 加工作区。性质：既有代码/报告盘点，无新实验、无DB查询或写入。
> 本目录补充上一版遗漏，并按研究对象分类。[用途与证据总表](FACTOR-ROLE-EVIDENCE-REGISTER-20261010.md)保留详细限制、替代关系和实验执行检查表；两文档共同使用。
> 目录范围：十二冻结因子、事件后路径候选、已定位组合、既有专题实验与策略规则。不是全库特征的穷尽清单；只发现定义时不声称有完成Run。数值为既有报告记录，未重算。

## 1. 分类与阅读顺序

| 板块 | 对象 | 如何计数 | 入口 |
|---|---|---|---|
| A 单因子：冻结基础因子 | 12个代码标识，按实体/量能/波动/历史/价格路径分组 | 同因子不同方向、TopN、期限是实验单元，不是新因子 | §2 |
| B 单因子：事件后动态路径 | 6族、报告清单29个名称 | 决策日D改变观察范围；不能将不同D的结果合并 | §3 |
| C 多因子：综合评分 | 12F、4F、2F、3F、4F加权、LONG-6/5/4、MEDIUM | 成员＋标准化＋方向＋权重＋样本坐标确定组合身份 | §4.1 |
| D 多因子：条件/交集/排除 | 均值×右尾、双尾共同极端、风险排除、LONG-4×后事件 | 条件分组不同于综合评分；交互检验不同于主效应 | §4.2 |
| E 专题研究维度 | 动态状态、量价、MA支撑、历史上下文等 | 实验名称不是因子名；待映射对象单独登记 | §5 |
| F 策略规则与环境 | Runner、止损、退出、资金、市场gate、失败标记 | 不是选股单因子；不用单因子IC评价 | §6 |

判定：**保留**＝指定用途有研究信息；**条件**＝限制未解除；**停止**＝指定用途已关闭；**探索**＝已有筛选但未充分验证；**待核**＝已定位资产，完成状态/定义映射尚未核清。以上均非数据库状态或交易许可。

## 2. A：十二个冻结基础单因子

权威定义起点：[十二因子 result.ts](../../research-experiments/first-board-pullback/twelve-factor-composite-study/result.ts)，按各项 `code` 定位；允许TopK列表见 [rightTailTypes.ts#RIGHT_TAIL_TOP_K_FACTOR_CODES](../../research-experiments/shared/singleFactor/rightTailTypes.ts)。通用实验已存在：[single-factor-v1](../../research-experiments/first-board-pullback/single-factor-v1/experiment.ts)。

下表概念释义用于导航，不代替实现公式。原十二因子的事件后观察最多至T+5；不能在T日提前使用T+1..5构造项。前期/事件日可知项与后续窗口项分别列出。

| 编号 | 子类 | code / 含义 | 最早信息窗口 | 研究用途与已有结论 | 状态 / 证据 |
|---|---|---|---|---|---|
| A01 | 事件日形态 | `bodyHeight` 首板实体高度 | 事件日OHLC | SHORT无稳定信息；LONG弱；HIGH有纯右尾信息但左尾恶化 | SHORT停止；右尾观察。[纯右尾](RESULT-PURE-RIGHT-TAIL-VALIDATION-001.md) |
| A02 | 事件日量能 | `turnover` 首板换手率 | 事件日 | LONG/MEDIUM成分；SHORT原始与残差方向冲突；右尾规则暂停 | 分用途保留/停止。[三尺度](RESULT-FACTOR-TIMESCALE-FINAL-001.md) |
| A03 | 同日横截面量能 | `amountPercentile` 同日成交额分位 | 事件日及同日候选横截面 | LOW均值研究有证据；LONG正、SHORT负；低流动性集中限制容量解释 | 条件保留。[可交易性](RESULT-AMOUNT-PERCENTILE-TRADABILITY-001.md) |
| A04 | 后事件波动 | `meanAmplitude` T+1..5平均振幅 | rd1..5 | 早期3F/4F成分；均值与右尾方向有权衡 | 用途保留；不等于`avgAmp5`。[均值](RESULT-MEAN-FACTOR-RESEARCH-001.md) |
| A05 | 后事件波动 | `maxAmplitude` T+1..5最大振幅 | rd1..5 | 早期最强组合成员之一；对右尾与均值的作用须区分 | 用途保留；不等于`maxAmp5`。[4F](RESULT-COMPOSITE-SUBSET4-001.md) |
| A06 | 后事件守价 | `holdStreak` 守涨停价连续期，收盘口径 | 对应后事件观察窗 | 右尾TopK并列支配；可保留描述性IC，不解释TopK结果 | TopK停止。[P3](RESULT-RIGHT-TAIL-R1-R5-P3-001.md) |
| A07 | 事件后量能 | `t1VolumeRatio` T+1量/T日量 | rd1 | 3F、4F量比成员；右尾规则方向暂停 | 早期组合证据保留；右尾用途停止。[约束组合](RESULT-COMPOSITE-CONSTRAINED-WEIGHT-001.md) |
| A08 | 历史事件 | `limitGap` 前次涨停间隔 | 事件前历史 | SHORT/LONG跨尺度相对信息；4F、LONG-4成员 | 保留研究用途，不等于绝对多头收益。[三尺度](RESULT-FACTOR-TIMESCALE-FINAL-001.md) |
| A09 | 前期收益 | `preReturn10` close(T−1)/close(T−10)−1 | rd−10..−1 | SHORT广度有信息；LONG-4池内买点否定；HIGH右尾型、左尾更厚 | 分用途保留/停止。[纯右尾](RESULT-PURE-RIGHT-TAIL-VALIDATION-001.md) |
| A10 | 事件后回撤 | `drawdownDepth` 对首板收盘的T+1..5回撤 | rd1..5 | HIGH右尾暴露；M-LOW条件研究有部分信息，符号翻转已否定 | 条件观察，Top3不可行动。[交互](RESULT-MEAN-TAIL-INTERACTION-VALIDATION-001.md) |
| A11 | 开盘执行环境 | `t1OpenGap` T+1开盘缺口 | rd1开盘 | 均值研究归D类、停止投入该方向；其他用途另查定义 | 指定均值用途停止。[均值](RESULT-MEAN-FACTOR-RESEARCH-001.md) |
| A12 | 历史事件频率 | `historyLimitCount` 历史涨停次数 | 事件前历史 | LONG主导；SHORT残差抑制效应待解释；累计量须注意年内归一化 | LONG保留；SHORT仅观察。[三尺度](RESULT-FACTOR-TIMESCALE-FINAL-001.md) |

**时点冲突处理：**[TARGET-REVIEW](RESULT-FACTOR-TIMESCALE-TARGET-REVIEW-001.md)曾称特定十二因子路径全部来自prefix/event，但冻结定义标签明确包含rd1..5项。该报告与实际对应derive路径、运行快照需逐项核对；不得沿用“十二项均T日已知”的总括。不同实验读取字段可能不同，本目录不因此宣布所有历史Run泄漏。

### A的实验链与现有范围

| 链路 | 覆盖 / 目标 | 已有资产 | 后续如何使用 |
|---|---|---|---|
| 通用单因子V1 | 原始值HIGH/LOW × Top3/5/10/20；T+5信息截止，T+6开盘入场、T+10收盘退出/顺延；20bps | [模板定义](../../research-experiments/first-board-pullback/single-factor-v1/experiment.ts)；[12F对齐报告](RESULT-12F-TOPN-002.md) | 已有模板，不为每个因子新写引擎；不是OOS |
| 右尾链 | 11个可TopK因子，H5/10/20/60，右尾超额、均值、左尾、随机子集 | [右尾超额](RESULT-RIGHT-TAIL-CROSS-SECTIONAL-EXCESS-001.md)；[纯右尾](RESULT-PURE-RIGHT-TAIL-VALIDATION-001.md) | 随机应为均匀无放回，不是仅随机破平 |
| 均值链 | 已冻结方向及相反方向诊断 | [均值报告](RESULT-MEAN-FACTOR-RESEARCH-001.md) | 不把样本内信息升级为策略增量 |
| 时间尺度链 | SHORT/MEDIUM/LONG IC、TopN及池内验证 | [最终汇总](RESULT-FACTOR-TIMESCALE-FINAL-001.md) | 全池与条件池结论分开，核实际观察窗 |

## 3. B：事件后动态路径单因子，按六族逐项列出

来源：[发现报告 §1.3/§2.3](RESULT-POST-EVENT-STATE-FACTOR-DISCOVERY-001.md)。数据780004；D∈{1,3,5,10,15,20}收盘构造；下一日开盘起算F∈{5,10,20,40}。合法单元受历史长度等条件限制。

**盘点差异：**报告标题称27个候选，但§1.3枚举实际为 **5＋6＋4＋4＋4＋6＝29个名称**。本目录逐名记录29项；实际计算候选数、600个合法单元与枚举映射须由 `factorsAt`/历史产物核对。不能静默删掉两项，也不能宣称29项全部被计算。

通过单元计数只是探索筛选次数，不是独立显著性、当前策略资格或多因子组合数量。未出现在通过数表的项标“未列逐项通过数”，不推断所有D/F下无效。

| 编号 | 族 | code / 概念 | 已有探索结果 | 当前角色与缺口 |
|---|---|---|---|---|
| B01 | 收益状态 | `retCum` 累计收益 | 通过5单元，低值方向 | 反转解释/探索；未见独立策略验证 |
| B02 | 收益状态 | `ret1` 近1日收益 | 通过2单元，低值方向 | 短期反转观察，核D/F有效域 |
| B03 | 收益状态 | `ret3` 近3日收益 | 通过1单元，低值方向 | 同上，不与ret1独立性默认成立 |
| B04 | 收益状态 | `ret5` 近5日收益 | 通过1单元，低值方向 | 同上，未单独晋级 |
| B05 | 收益状态 | `posInEventBar` 当前价在事件日区间位置 | 通过7单元，低值方向 | 路径位置候选；不同于实体高度 |
| B06 | 回撤/反弹 | `ddFromEventHigh` 距事件后阶段高点回撤 | 报告列D1/F40成本后负的单元 | 不全局判无效；与M2阈值用途区分 |
| B07 | 回撤/反弹 | `ddRecent5` 近5日回撤 | 未列逐项通过数 | 已枚举，逐单元证据待核 |
| B08 | 回撤/反弹 | `maxDD` 路径最大回撤 | 未列逐项通过数 | 与A10参考价/窗口不同，不合并 |
| B09 | 回撤/反弹 | `reboundFromLow` 自低点反弹 | 通过7单元，低值方向 | 低反弹候选；不是“反弹越大越好” |
| B10 | 回撤/反弹 | `recoveryRatio` 恢复比例 | 通过5单元，低值方向 | 公式和分母边界查原harness；未独立验证 |
| B11 | 回撤/反弹 | `distFromHigh0` 距事件日高点 | 未列逐项通过数 | 与阶段高点回撤不同，待核 |
| B12 | 价格结构 | `pxVsMA5` 相对MA5 | 未列逐项通过数 | 状态解释，核D不足5的可用条件 |
| B13 | 价格结构 | `pxVsMA10` 相对MA10 | 未列逐项通过数 | 状态解释，核历史长度与数据窗口 |
| B14 | 价格结构 | `ma5VsMA10` MA5/MA10关系 | 未列逐项通过数 | 不等于Runner趋势止盈规则 |
| B15 | 价格结构 | `isNewHigh5` 近5日新高 | D1/F40成本后负的单元 | 探索限定，不能据名字作为追强买点 |
| B16 | 波动 | `avgAmp5` 决策日前近5日平均振幅 | 通过12单元，低值方向；后续稳定性/对照 | 研究候选，与maxAmp5高度相关，不能当独立Alpha |
| B17 | 波动 | `maxAmp5` 决策日前近5日最大振幅 | 通过10单元，低值方向；后续形成Event-State候选 | 有后续验证；原D段Stage1 FAIL可见，不默认取代Runner |
| B18 | 波动 | `ampTrend` 振幅趋势 | 通过4单元，低值方向 | 收缩状态探索，暂无单独正式部署证据 |
| B19 | 波动 | `upDownVolDiff` 原报告列入波动族 | 通过4单元，低值方向 | 名称不足以确定vol是波动还是成交量，公式待核 |
| B20 | 成交量 | `volVsEvent` 量相对事件日 | 未列逐项通过数 | 探索项，不与A07直接合并 |
| B21 | 成交量 | `volTrend` 成交量趋势 | D10/F40成本后负的单元 | 指定单元不支持绝对收益；全域结论待核 |
| B22 | 成交量 | `upVolDownVol` 上涨/下跌量关系 | 未列逐项通过数 | 与B19不同标识，未证独立性 |
| B23 | 成交量 | `volRatioChange` 量比变化 | D5/F40成本后负的单元 | 探索限定，不直接作为过滤 |
| B24 | 路径形态 | `upDayShare` 上涨日比例 | 未列逐项通过数 | 描述路径，未来入场增量未证明 |
| B25 | 路径形态 | `maxUpStreak` 最大连续上涨 | 未列逐项通过数 | 非A06守涨停价streak，不混用 |
| B26 | 路径形态 | `maxDownStreak` 最大连续下跌 | 未列逐项通过数 | 非M5结尾连续下跌阈值，不混用 |
| B27 | 路径形态 | `daysToBreakEventHigh` 已观察窗内突破耗时 | 未列逐项通过数 | 未突破的编码与归一化查实现；不得搜索未来突破日 |
| B28 | 路径形态 | `brokeAndFailed` 突破后失败状态 | 未列逐项通过数 | 已枚举，实际计算覆盖待核 |
| B29 | 路径形态 | `aboveEventHigh` 位于事件高点之上 | 未列逐项通过数 | 已枚举，实际计算覆盖待核 |

后续证据仅对部分项深入：[稳定性](RESULT-POST-EVENT-STATE-TIMESCALE-STABILITY-001.md)、[修正随机对照](RESULT-POST-EVENT-STATE-NB-RANDOM-002.md)、[max/avg正交性](RESULT-POST-EVENT-STATE-LONG-ORTHOGONALITY-001.md)、[后续验证](RESULT-VALIDATION-FINAL-001.md)、[正式一致性进度](RESULT-EVENT-STATE-LONG-EXECUTION-PARITY-001.md)。早期简化引擎CAGR/Sharpe等不能替代后续正式指标。

## 4. 多因子：评分组合与条件组合分别登记

### 4.1 C：综合评分组合

| 编号 | 组合 / 成员 | 构造与坐标 | 已有证据 / 状态 | 证据入口 |
|---|---|---|---|---|
| C01 | 12F等权：A01–A12全部 | 桶位标准化＋冻结方向＋等权；660001/v5，T+6→10，20bps | 正式研究Run已记录；头部弱于多个单因子，探索性 | [12F](RESULT-12F-TOPN-002.md)；[定义](../../research-experiments/first-board-pullback/composite-factor-equal-weight-study/experiment.ts) |
| C02 | 4F等权：maxAmplitude、meanAmplitude、t1VolumeRatio、limitGap | 各25%，同C01面板 | 四档头部相对优势改善；事后选择成员，非OOS | [4F子集](RESULT-COMPOSITE-SUBSET4-001.md) |
| C03 | 2F双振幅：maxAmplitude＋meanAmplitude | 各50%，同C01 | 正式研究Run；N3未定，其他档正向；不称独立维度 | [约束组合](RESULT-COMPOSITE-CONSTRAINED-WEIGHT-001.md) |
| C04 | 3F双振幅＋量比：maxAmplitude、meanAmplitude、t1VolumeRatio | 各1/3，桶位分；同C01 | 正式研究Run，四档探索性正向；历史3F选股源头，非151%收益本身 | [约束组合](RESULT-COMPOSITE-CONSTRAINED-WEIGHT-001.md) |
| C05 | 4F加权：同C02 | 35/35/15/15%；同C01 | 四档劣于4F等权；不继续据此调权择优 | [约束组合](RESULT-COMPOSITE-CONSTRAINED-WEIGHT-001.md) |
| C06 | 3F连续化：同双振幅＋量比 | 连续分替代旧2/5/5分桶的研究诊断 | 增量≤0.005，模块已做但不接正式策略；不是新部署版本 | [集中度第四轮](RESULT-151PCT-WINNER-CONCENTRATION-001.md) |
| C07 | LONG-6：amountPercentile、limitGap、historyLimitCount、turnover、bodyHeight、preReturn10 | 当日百分位rank等权，780004，LONG目标窗口 | preReturn10在该组合负贡献，未推荐此组合 | [LONG组合](RESULT-FACTOR-TIMESCALE-LONG-COMBO-001.md) |
| C08 | LONG-5：C07去preReturn10 | 同C07 | 有探索对照，不能与早期4F混名 | [LONG组合](RESULT-FACTOR-TIMESCALE-LONG-COMBO-001.md) |
| C09 | LONG-4：amountPercentile、limitGap、historyLimitCount、turnover | C08再去bodyHeight；当日rank等权 | 保留长期池排序；真实资金路径/随机对照有证据；宽度扩张停止 | [汇总](RESULT-FACTOR-TIMESCALE-FINAL-001.md)；[利用率](RESULT-LONG4-UTILIZATION-BENCHMARK-001.md) |
| C10 | MEDIUM-6：limitGap、turnover、amountPercentile、preReturn10、historyLimitCount、bodyHeight | 中期相对强弱组合，780004 | 相对随机减亏；绝对收益负；LONG-4池内增量不显著 | [MEDIUM](RESULT-MEDIUM-REAL-001.md)；[池内](RESULT-MEDIUM-HOLDING-STATE-001.md) |

**同为“四因子”不等于同一个组合：C02与C09的成员、标准化、窗口完全不同。单因子Top3持仓组合也不是多因子评分；Event-State maxAmp5 Top3仍是单因子策略。**

### 4.2 D：条件、交集、排除与混合组合

| 编号 | 组合 / 规则 | 类型 / 已研究问题 | 结论与限制 | 来源 |
|---|---|---|---|---|
| D01 | amountPercentile LOW × drawdownDepth LOW/MID/HIGH | 条件分组及风险/右尾关系 | 条件信息部分成立；符号翻转否定；Top3覆盖3.1%，不可行动 | [条件001](RESULT-MEAN-SELECTION-TAIL-CONTROL-001.md)；[交互复核](RESULT-MEAN-TAIL-INTERACTION-VALIDATION-001.md) |
| D02 | amountPercentile LOW × preReturn10 LOW/MID/HIGH | 条件主效应/形式化DiD | 右尾主效应但均值交互CI跨0；左尾更差；Top3覆盖1% | [条件002](RESULT-MEAN-SELECTION-TAIL-CONTROL-002-PRETRETURN10.md) |
| D03 | M轴amountPercentile × R轴drawdownDepth/preReturn10/bodyHeight | 独立性/残差分析，不是交易组合 | 有轴信息；bodyHeight较弱；不等于可用权重 | [独立性](RESULT-MEAN-TAIL-INDEPENDENCE-001.md) |
| D04 | B1 meanAmplitude∩preReturn10 | 双因子各Top20%交集，再主因子Top3 | 相对单因子均值改善，但仍劣于随机；保留右尾不等于正期望 | [七规则](RESULT-RIGHT-TAIL-SELECTION-RULE-001.md) |
| D05 | B2 meanAmplitude∩maxAmplitude | 同D04交集 | 未解决均值劣势；停止该规则优化 | 同上 |
| D06 | B3 preReturn10∩limitGap | 同D04交集 | 对应均值差显著更差；停止 | 同上 |
| D07 | B4 maxAmplitude∩limitGap | 同D04交集 | 无有效均值修复；停止 | 同上 |
| D08 | C1 meanAmplitude排除drawdownDepth Top20% | 风险排除＋主因子Top3 | 未解决均值劣势；不继续搜索排除阈值 | 同上 |
| D09 | C2 preReturn10排除drawdownDepth Top20% | 同D08 | 均值CI跨0不代表改善；牺牲尾部 | 同上 |
| D10 | C3 meanAmplitude排除preReturn10 Top20% | 同D08 | 尾部损失明显；停止 | 同上 |
| D11 | LONG-4＋maxAmp5 / LONG-4＋avgAmp5 | T+15等权rank混合增量 | 比LONG-4单独好，但该轮缺单独后事件臂；不能称协同或组合优胜 | [增量](RESULT-POST-EVENT-STATE-INCREMENTAL-ALPHA-001.md) |
| D12 | maxAmp5＋avgAmp5 | 相关性/冗余诊断，非已部署组合 | 相关约0.899；不作为两条独立Alpha，不启动权重搜索 | [正交性](RESULT-POST-EVENT-STATE-LONG-ORTHOGONALITY-001.md) |
| D13 | LONG×MEDIUM×SHORT综合评分 | 跨尺度组合方向 | 当前停止；冗余和池内证伪结果不能因全池IC漂亮而忽略 | [最终冻结](RESULT-FACTOR-TIMESCALE-FINAL-001.md) |

## 5. E：既有专题研究，不丢弃但不冒充单因子结论

下面是前版遗漏的代码资产。每项已找到实际实验入口；本轮未逐个取得对应Run信封，因此完成状态、具体分组效应和冻结参数标**待核**。这不表示未执行，后续先查询/复用旧证据。

| 专题 / 维度 | 对象分类 | 已存在的实验入口（first-board-pullback下） | 使用限制 |
|---|---|---|---|
| 首板实体高度与支撑 | 单变量分组 / 条件筛选 | `first-board-body-study`、`body-ma-support-screen-study`、`body-filtered-exit-curve-study` | 区分实体指标、MA组合门与退出；不合并成一个新因子 |
| 换手 | 单变量专题 | `turnover-study` | 与A02定义和时点对照后再映射 |
| 前事件空窗与涨幅 | 单变量＋联合分组 | `pre-event-context-study` | 涨停间隔/前期涨幅窗口可不同，不直接当A08/A09同版本 |
| 动态状态扩展 | 单变量解释面板 | `dynamic-state-factor-expansion-study` | 固定状态机下：换手/振幅/实体/成交额同日分位、历史涨停数、T+1缺口、量比；不改入场退出 |
| 量恢复/量价关系 | 条件过滤 / 动态入场 | `volume-recovery-filtered-validation`、`volume-relationship-dynamic-entry-study` | 量关系是输入，状态机是规则；等待旧Run定位 |
| 超跌缺口反转 | 条件组合 | `oversold-gap-reversal-validation` | 未核具体组成，不能据名称宣称正收益 |
| 事件后振幅 | 单变量专题 | `post-event-amplitude-study` | 与A04/A05和B16/B17窗口不同，需映射 |
| 守涨停价/开盘价/连续期 | 状态专题与持有规则 | `hold-open-price-pullback`、`limit-up-close-hold-study`、`limit-up-price-hold-streak-study`、`hold-streak-amplitude-t10-study` | 守价基准与streak定义不同；不统称holdStreak有效 |
| 第一性、入场时点、决策前向 | 事件/路径描述与执行时点 | `fundamental-study`、`entry-day`、`decision-forward-study`、`dynamic-entry-path-distribution-study` | 描述结果非选股Alpha；窗口与可知时点先核 |
| 组合OOS与稳定性 | 验证实验 | `composite-factor-oos-validation-study`、`stability-validation` | 需核发现历史与冻结时间，不从名字推断严格未见 |

代码导航：[first-board-pullback目录](../../research-experiments/first-board-pullback)。资产完整性后续按manifest实际注册id、Run清单和结果来源逐条闭合；不得仅统计目录数称所有实验已完成。

## 6. F：策略、退出、环境与过滤块

### 6.1 151%策略及其变体

| 对象 | 类别 | 当前证据定位 / 动作 |
|---|---|---|
| 原3F＋Top3＋Runner t74 | 多因子入场＋组合资金＋退出政策 | [归因](RESULT-151PCT-ATTRIBUTION-001.md)与[集中度](RESULT-151PCT-WINNER-CONCENTRATION-001.md)；主基线，不能简化成一个止盈单因子 |
| Runner有/无、hold20、止损放宽 | 退出政策/参数对照 | [退出方案作废](PLAN-EXIT-POLICY-001.md)已有消融和重复实验说明，不再原样重跑 |
| 趋势分/趋势gate/v2 | 排序融合与条件门 | `composite-runner-newhigh3-t74-trend` / `trend-gate` / `trend-v2`；查既有P族，默认不重新搜索 |
| Top5、slots、carryover/refresh | 组合宽度与候选状态 | 对应t74实验已存在；不是新增Alpha因子 |
| late-entry、event-gate、subnew、inverted | 时点、事件门、上市龄、排序方向 | 对应t74实验存在；逐项复用审计，不能由目录推断正面效果 |
| 退出视界、阈值竞争、条件回踩状态 | 退出研究 | `entry-aligned-exit-horizon-study`、`threshold-race-policy-study`、`conditional-pullback-state-exit-study`；不再默认“退出未研究” |
| 仓位比例 / 现金 / 组合熔断 | 暴露与账户规则 | 不混入因子IC表；当前完成状态先核，不自动批准实施 |

### 6.2 环境变量

| 对象 | 研究用途 | 当前状态 |
|---|---|---|
| 指数t−1 MA20状态 | 市场gate解释 | 多指数复核撤回初判；不采用当日状态解释同日收益 |
| t−1池候选数 / 全市场涨停数 / 全市场跌停数 | 机会活跃度/热度解释 | 三项IS/OOS翻号，按停止规则关闭，不追加候选凑解释 |

来源：[F4更正与有界停止](RESULT-F4-REGIME-001.md)。年度集中是观测，不是上述环境变量解释成立。

### 6.3 T+15失败路径标记（阈值规则，不算29个新单因子）

| 标记 | 规则或维度 | 类别与现有状态 |
|---|---|---|
| M1 | rd1..15最大回撤≤−20% | 回撤阈值；总体与Top3条件效应分别看 |
| M2 | 距阶段高点回撤≤−25% | 回撤阈值；作为排除过滤伤害收益 |
| M3 / M4 | close15低于事件日low / close | 关键价破位；不等同稳定失败方向 |
| M5 | rd15结尾连续下跌≥3日 | 连续路径；区别B26最大连续下跌 |
| M6 | 观察窗大阴线≥2根 | 路径计数；IS/OOS方向翻转，不稳定 |
| M7 | 阶段涨幅≥30%且距高点回撤≥25% | 两条件路径；不升级择优组合 |
| M8 | rd15累计收益≤0 | 收益阈值；收益标签不得参与标记 |
| M9 | 事件区间位置≤0.20 | 位置阈值；区别B05原始值排序 |
| M10 | maxAmp5≥0.12 | 波动阈值；与Top3重叠极少，无过滤空间 |
| J1 | 阶段涨幅≥30%且距高点回撤<25% | 事前2×2表单元格；总体信息不等于池内过滤增量 |
| J2 | 阶段涨幅≥30% | 事前2×2表一条腿；池内排除误删较好交易 |
| J3 | 距阶段高点回撤<25% | 事前2×2表一条腿；覆盖Top3约90.7%，池内差异不显著 |
| J4 | 累计收益≥30% | Stage3追加、非事前登记；池内仅5例，不视为预注册确认 |

来源：[预注册定义](PREREG-PRE-T15-FAILURE-PATH-DISCOVERY-001.md)与[结果](RESULT-PRE-T15-FAILURE-PATH-DISCOVERY-001.md)。整体收口为描述/观察；不继续阈值或组合搜索。

## 7. 每类研究需要什么实验

| 对象类别 | 已有通用能力 / 最小问题 | 必须补充的关键检查 | 不必每项重复 |
|---|---|---|---|
| 基础单因子 | SINGLE_FACTOR模板、分布/分组/随机对照 | 定义/时点、并列、排除样本、左右尾、年度、相关性 | 已有同坐标实验不重跑，不为单因子新建引擎 |
| 动态单因子 | 固定D构造、D+1入场、固定F标签 | 历史长度、PIT、D/F多重选择、成本后绝对收益 | 不把每个D当新独立因子，不追加时点择优 |
| 评分组合 | 同面板：组合/各成员/基线 | 成员、方向、标准化、权重、增量与冗余 | 不凭组合胜弱基线称协同；不自动搜索权重 |
| 条件组合 | 主因子单独、条件分组、同日配对 | 条件覆盖、左右尾、正式交互CI、实际TopK可行性 | 分组有信息不等于可交易；不填充缺名额 |
| 退出/仓位规则 | 冻结信号，完整资金循环对照 | 机会集变化、直接P&L、占仓残差、回撤、赢家保留 | 不用单笔均值或IC替代组合级证据 |
| 环境/过滤 | 决策前可见状态＋固定基线 | 漏掉赢家、减亏、市场暴露、阈值训练边界 | 已关闭方向不因新报告好看自动重开 |

完整执行门禁和可复制实验卡仍见[原总表 §6](FACTOR-ROLE-EVIDENCE-REGISTER-20261010.md#6-实验执行检查表)。本轮只整理；待核项是证据定位任务，不是新增回测队列。
