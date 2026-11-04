# 研究报告 · Run #1

> **本报告是既有 Research 结果的展示层投影（PHASE-A-001）。**
> 全部数值直接引自 `research_result` / `research_finding` / `research_conclusion`，
> 生成过程**未重新查询原始行情、未重算收益或条件统计、未重算 Finding**。
> 报告不包含最佳参数、策略推荐、收益承诺或买卖建议；
> 指标名称一律使用 `metricCode` 原文，不做业务化改名。

实验：**首板后不破涨停日当天收盘价实验v0.1**

## 1. 基本信息

| 项 | 值 |
| --- | --- |
| Report | Research Report（`artifactType = REPORT`） |
| Experiment | #360001 · 首板后不破涨停日当天收盘价实验v0.1 |
| 研究类型 | CONDITIONAL |
| Run | #1（runId=630001）· 状态 COMPLETED |
| Dataset Version | 首板回踩（first_limit_pullback）· v2（datasetVersionId=390002） |
| Dataset 覆盖 | 2024-09-01 ~ 2026-09-01 · 事件 23978 |
| Run 样本量 | 23978 |
| Run 完成时间 | 2026-09-16T15:34:18.000Z |
| 数据快照时间 | 2026-09-16T15:33:23.480Z |
| 快照 Dataset Version | 390002 |
| Pattern | （无法确定：Run 下分析的 `moduleKey` 未能反查到交易模式声明） |
| 结论归属 | #570001（INCONCLUSIVE） |
| Generator Version | 1.0.0 |

## 2. Research Analysis 清单

共 **1** 条分析（全部来自 `research_analysis`，未凭空生成）。

| analysisId | 类型 | Module | 状态 | 目标(target) | 优先级 | 结果行 | 主要配置摘要 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #600001 | SEGMENT_RELATION | — | COMPLETED | — | — | 31 | {"windowA":[1,5],"windowAStat":"max_drawdown","windowB":[5,10],"windowBStat":"max_return","windowBands":5} |

## 3. Research Result

共 **31** 行结果（全部来自 `research_result`，**原样引用**：不重算、不换算、不补 0）。

**逐分析结果行数**

| analysisId | 分析名 | 结果行 | 结果形态 |
| --- | --- | --- | --- |
| #600001 | 在首板后T+1日到T+5日，最低收盘价不低于首板涨停价 | 31 | GROUPED/SCALAR |

**结果明细**

#### #600001 · 在首板后T+1日到T+5日，最低收盘价不低于首板涨停价（SEGMENT_RELATION）

| resultId | metricCode | 类型 | 维度 | 值 | 样本量 | 明细 |
| --- | --- | --- | --- | --- | --- | --- |
| #570001 | SAMPLE_COUNT | GROUPED | {"windowA":1} | 4684 | 4684 | {"actualBands":5,"band":1,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"过滤非有限值后的样本数。","overla…（已截断，完整内容见原表字段） |
| #570002 | MEAN_RETURN | GROUPED | {"windowA":1} | 0.07229321524441029 | 4684 | {"actualBands":5,"band":1,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"有限样本的算术平均（作用于收益型变量）。"…（已截断，完整内容见原表字段） |
| #570003 | MEDIAN_RETURN | GROUPED | {"windowA":1} | 0.04871716543096827 | 4684 | {"actualBands":5,"band":1,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"有限样本的中位数（作用于收益型变量）。",…（已截断，完整内容见原表字段） |
| #570004 | STD_RETURN | GROUPED | {"windowA":1} | 0.08166253028362697 | 4684 | {"actualBands":5,"band":1,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"有限样本的标准差（除以 n−1，作用于收益…（已截断，完整内容见原表字段） |
| #570005 | WIN_RATE | GROUPED | {"windowA":1} | 0.9099060631938514 | 4684 | {"actualBands":5,"band":1,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"**严格大于 0** 的样本占比（v > …（已截断，完整内容见原表字段） |
| #570006 | SAMPLE_COUNT | GROUPED | {"windowA":2} | 4687 | 4687 | {"actualBands":5,"band":2,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"过滤非有限值后的样本数。","overla…（已截断，完整内容见原表字段） |
| #570007 | MEAN_RETURN | GROUPED | {"windowA":2} | 0.07439253218083082 | 4687 | {"actualBands":5,"band":2,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"有限样本的算术平均（作用于收益型变量）。"…（已截断，完整内容见原表字段） |
| #570008 | MEDIAN_RETURN | GROUPED | {"windowA":2} | 0.048606610499027925 | 4687 | {"actualBands":5,"band":2,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"有限样本的中位数（作用于收益型变量）。",…（已截断，完整内容见原表字段） |
| #570009 | STD_RETURN | GROUPED | {"windowA":2} | 0.0841959407694901 | 4687 | {"actualBands":5,"band":2,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"有限样本的标准差（除以 n−1，作用于收益…（已截断，完整内容见原表字段） |
| #570010 | WIN_RATE | GROUPED | {"windowA":2} | 0.9214849583955622 | 4687 | {"actualBands":5,"band":2,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"**严格大于 0** 的样本占比（v > …（已截断，完整内容见原表字段） |
| #570011 | SAMPLE_COUNT | GROUPED | {"windowA":3} | 4682 | 4682 | {"actualBands":5,"band":3,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"过滤非有限值后的样本数。","overla…（已截断，完整内容见原表字段） |
| #570012 | MEAN_RETURN | GROUPED | {"windowA":3} | 0.07395659263989773 | 4682 | {"actualBands":5,"band":3,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"有限样本的算术平均（作用于收益型变量）。"…（已截断，完整内容见原表字段） |
| #570013 | MEDIAN_RETURN | GROUPED | {"windowA":3} | 0.048880423555286434 | 4682 | {"actualBands":5,"band":3,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"有限样本的中位数（作用于收益型变量）。",…（已截断，完整内容见原表字段） |
| #570014 | STD_RETURN | GROUPED | {"windowA":3} | 0.08375451193211393 | 4682 | {"actualBands":5,"band":3,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"有限样本的标准差（除以 n−1，作用于收益…（已截断，完整内容见原表字段） |
| #570015 | WIN_RATE | GROUPED | {"windowA":3} | 0.9139256727894064 | 4682 | {"actualBands":5,"band":3,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"**严格大于 0** 的样本占比（v > …（已截断，完整内容见原表字段） |
| #570016 | SAMPLE_COUNT | GROUPED | {"windowA":4} | 4683 | 4683 | {"actualBands":5,"band":4,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"过滤非有限值后的样本数。","overla…（已截断，完整内容见原表字段） |
| #570017 | MEAN_RETURN | GROUPED | {"windowA":4} | 0.07245894196652426 | 4683 | {"actualBands":5,"band":4,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"有限样本的算术平均（作用于收益型变量）。"…（已截断，完整内容见原表字段） |
| #570018 | MEDIAN_RETURN | GROUPED | {"windowA":4} | 0.04909560723514206 | 4683 | {"actualBands":5,"band":4,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"有限样本的中位数（作用于收益型变量）。",…（已截断，完整内容见原表字段） |
| #570019 | STD_RETURN | GROUPED | {"windowA":4} | 0.08103658418765887 | 4683 | {"actualBands":5,"band":4,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"有限样本的标准差（除以 n−1，作用于收益…（已截断，完整内容见原表字段） |
| #570020 | WIN_RATE | GROUPED | {"windowA":4} | 0.9130898996369848 | 4683 | {"actualBands":5,"band":4,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"**严格大于 0** 的样本占比（v > …（已截断，完整内容见原表字段） |
| #570021 | SAMPLE_COUNT | GROUPED | {"windowA":5} | 4684 | 4684 | {"actualBands":5,"band":5,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"过滤非有限值后的样本数。","overla…（已截断，完整内容见原表字段） |
| #570022 | MEAN_RETURN | GROUPED | {"windowA":5} | 0.0967842184148162 | 4684 | {"actualBands":5,"band":5,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"有限样本的算术平均（作用于收益型变量）。"…（已截断，完整内容见原表字段） |
| #570023 | MEDIAN_RETURN | GROUPED | {"windowA":5} | 0.06621188067513795 | 4684 | {"actualBands":5,"band":5,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"有限样本的中位数（作用于收益型变量）。",…（已截断，完整内容见原表字段） |
| #570024 | STD_RETURN | GROUPED | {"windowA":5} | 0.11459138372994455 | 4684 | {"actualBands":5,"band":5,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"有限样本的标准差（除以 n−1，作用于收益…（已截断，完整内容见原表字段） |
| #570025 | WIN_RATE | GROUPED | {"windowA":5} | 0.8742527754056362 | 4684 | {"actualBands":5,"band":5,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"lowSample":false,"metricDefinition":"**严格大于 0** 的样本占比（v > …（已截断，完整内容见原表字段） |
| #570026 | PAIR_CORRELATION | SCALAR | — | 0.09351996082143264 | 23420 | {"actualBands":5,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"metricDefinition":"两条**按事件对齐**序列的皮尔逊相关系数（shared/quant-stats.pearson…（已截断，完整内容见原表字段） |
| #570027 | PAIR_RANK_CORRELATION | SCALAR | — | 0.05571410045213208 | 23420 | {"actualBands":5,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"metricDefinition":"两条按事件对齐序列的斯皮尔曼秩相关（并列值取平均秩，shared/quant-stats.spe…（已截断，完整内容见原表字段） |
| #570028 | PAIR_SAMPLE_COUNT | SCALAR | — | 23420 | 23420 | {"actualBands":5,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"metricDefinition":"两侧同时有限、真正进入关系计算的**配对**样本数（不是任一单侧的样本数）。同一分析里各窗口统计…（已截断，完整内容见原表字段） |
| #570029 | SPREAD_TOP_BOTTOM | SCALAR | — | 0.02449100317040589 | 9368 | {"actualBands":5,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","bottomBand":1,"bottomMean":0.07229321524441029,"cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"metricDefinition":"…（已截断，完整内容见原表字段） |
| #570030 | T_STAT_DIFFERENCE | SCALAR | — | 11.911951766889594 | 9368 | {"actualBands":5,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","bottomBand":1,"bottomMean":0.07229321524441029,"cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"metricDefinition":"…（已截断，完整内容见原表字段） |
| #570031 | P_VALUE_DIFFERENCE | SCALAR | — | 0 | 9368 | {"actualBands":5,"bandingRule":"band(v) = 1 + \|{k : v > percentile(窗A取值, k/G)}\|；与 QUANTILE 同一分档规则（相同值不劈开）。","bottomBand":1,"bottomMean":0.07229321524441029,"cutPoints":[-0.09626655852933227,-0.05405405405405406,-0.024390243902438935,0.006791637225154867],"excludedForMissing":558,"metricDefinition":"…（已截断，完整内容见原表字段） |

## 4. Finding

本 Run 下**没有 Finding**。

⚠️ 「没有发现」是**合法且必须如实展示**的结果（任务书 §27）：Finding 层只消费已落库的 Result，
查不到符合判定策略的模式时就不产出 Finding。此处不为了报告好看而补齐任何条目。

## 5. Conclusion

- 结论 id / 类型 / 状态：#570001 · `INCONCLUSIVE` · `DRAFT`
- 标题：首板后不破涨停日当天收盘价实验v0.1 — 自动结论（INCONCLUSIVE）
- 置信度：0.9（**主观置信度 [0,1]，不是 p-value**）
- 研究问题（原文）：—

**结论正文（`research_conclusion.conclusion` 原文）**

假设：「首板后震荡几天，后续收益会有明显提高。也就是涨停试盘的策略」

判定：**方向不稳定**：整体效应达标，但分组/跨期方向一致性过低，不能判定为稳定关系。

关键量：窗 A（T+1..5 分段最大跌幅）第 5 档 − 第 1 档 的 窗 B（T+5..10 分段最大有利偏移）均值差 = 0.0245；p = 0.0000；t = 11.9120；样本 23420（最小分组 4682）；方向一致性 0.500。

判定依据（按顺序短路）：
1. [通过] R2_样本达标 —— 总样本 23420（门槛 30），最小分组样本 4682（门槛 30）
2. [通过] R3_效应达到最小实际阈值 —— |效应| = 0.0245，阈值 0.005
3. [通过] R4_统计量达标 —— p = 0.0000，alpha = 0.05
4. [未通过] R5_方向稳定 —— 一致性 0.500，下限 0.6

⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。

**证据摘要（人读）**：—

**引用的 Finding id**：—

**机器可读证据（`evidenceJson` 的结构化要点）**

- 主分析：analysisId=600001，类型=SEGMENT_RELATION，效应=0.024491003170405895，p=0，样本=23420
- 主分析选择规则：按 QUANTILE → CONDITIONAL → EVENT_STUDY → STABILITY → SEGMENT_RELATION 的固定优先级选择主分析（不按效应大小挑选，避免选择性报告）
- 参与分析（1 条）：
  - analysisId=600001，类型=SEGMENT_RELATION，效应=0.024491003170405895，p=0，样本=23420
- 规则判定轨迹：
  - 通过 · R2_样本达标：总样本 23420（门槛 30），最小分组样本 4682（门槛 30）
  - 通过 · R3_效应达到最小实际阈值：|效应| = 0.0245，阈值 0.005
  - 通过 · R4_统计量达标：p = 0.0000，alpha = 0.05
  - 未通过 · R5_方向稳定：一致性 0.500，下限 0.6

**结论策略 policy（原样引用 `evidence.policy`，未改写）**

`alpha=0.05, materialityAbs=0.50%, minSampleCount=30, stabilityMinConsistentRatio=0.6`

**免责声明 disclaimer（原样引用 `evidence.disclaimer`，未删除、未改写）**

⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。

## 6. Limitations / Open Questions

以下内容**全部为既有数据的原文引用或客观计数**，不含生成器自行推导的新结论。

### 6.1 样本 / 数据层面的限制

- 数据坐标：Dataset Version 390002（first_limit_pullback · v2），区间 2024-09-01 ~ 2026-09-01，事件 23978。
- 可用 outcome 视界：[5,10,20]。
- 观察日（post）取值范围：[1, 20]。
- 本 Run 使用的样本量：23978。

### 6.2 结论声明的局限（`research_conclusion.limitationsJson` 原文）

（无）

### 6.3 Finding 自带局限（`research_finding.limitationsJson` 原文）

（无）

### 6.4 未决问题（`research_conclusion.nextQuestionsJson` 原文）

（无）

### 6.5 未能可靠取得的溯源字段

- patternId（分析的 moduleKey 未能反查到模式声明）

## 7. 免责声明

本报告不含投资建议。

**Finding 层免责声明（`researchCore/findings.ts#FINDING_DISCLAIMER` 原文）**

⚠️ 自动发现仅为**研究辅助**，不等同于统计显著性或交易有效性；研究强度只是**研究优先级**指标，不是策略评分、不构成任何买卖建议。任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立。

**结论层免责声明**：见上文「结论」一节的 `evidence.disclaimer` 原文。

研究强度只是**研究优先级**指标，不是策略评分；任何策略性判断必须经 Backtest / 稳健性 / OOS
验证后才可成立。本报告不产出买卖建议、不承诺收益。
