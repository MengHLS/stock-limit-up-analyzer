# RESEARCH-006.2 前状态只读审计（真实 TiDB）

## 1. 行数基线（真实 TiDB）

```json
{
  "research_experiment": 2,
  "research_hypothesis": 0,
  "research_run": 8,
  "research_analysis": 19,
  "research_result": 674,
  "research_conclusion": 7,
  "research_strategy_candidate": 0,
  "strategy_research_provenance": 0,
  "strategies": 0,
  "strategy_versions": 0,
  "strategy_version_datasets": 0,
  "dataset_version": 2
}
```

## 2. 是否有在途 Run（RUNNING / PENDING）—— 提示热重启风险

```json
[]
```

## 3. Conclusion → Experiment → Dataset Version 坐标（真实）

```json
[
  {
    "conclusionId": 180001,
    "conclusionStatus": "DRAFT",
    "conclusionType": "PARTIALLY_SUPPORTED",
    "title": "首板换手率与未来五日收益的关系 — 自动结论（PARTIALLY_SUPPORTED）",
    "hypothesisId": null,
    "conclusionHead": "假设：「(未登记假设陈述)」\n\n判定：**方向一致但统计强度不足**：差异存在方向性，但未能通过预设统计门槛。\n\n关键量：Q10 − Q1 的 future_return_5d 均值差 = -0.0308；p = 0.0930；t = -1",
    "experimentId": 180001,
    "experimentName": "首板换手率与未来五日收益的关系",
    "experimentStatus": "COMPLETED",
    "datasetVersionId": 390001,
    "datasetLabel": "v1",
    "datasetStatus": "READY",
    "datasetCode": "first_limit_pullback"
  },
  {
    "conclusionId": 180002,
    "conclusionStatus": "DRAFT",
    "conclusionType": "SUPPORTED",
    "title": "首板换手率与未来五日收益的关系 — 自动结论（SUPPORTED）",
    "hypothesisId": null,
    "conclusionHead": "假设：「(未登记假设陈述)」\n\n判定：**在预设规则下支持该假设**（样本、效应量、统计量、方向稳定性四项均达标）。\n\n关键量：T+2 未来收益均值（1127 个样本） = 0.0147；p = 0.0000；t = 4.3085；样本 1",
    "experimentId": 180001,
    "experimentName": "首板换手率与未来五日收益的关系",
    "experimentStatus": "COMPLETED",
    "datasetVersionId": 390001,
    "datasetLabel": "v1",
    "datasetStatus": "READY",
    "datasetCode": "first_limit_pullback"
  },
  {
    "conclusionId": 210001,
    "conclusionStatus": "DRAFT",
    "conclusionType": "PARTIALLY_SUPPORTED",
    "title": "首板换手率与未来五日收益的关系 — 自动结论（PARTIALLY_SUPPORTED）",
    "hypothesisId": null,
    "conclusionHead": "假设：「(未登记假设陈述)」\n\n判定：**方向一致但统计强度不足**：差异存在方向性，但未能通过预设统计门槛。\n\n关键量：Q10 − Q1 的 future_return_5d 均值差 = -0.0308；p = 0.0930；t = -1",
    "experimentId": 180001,
    "experimentName": "首板换手率与未来五日收益的关系",
    "experimentStatus": "COMPLETED",
    "datasetVersionId": 390001,
    "datasetLabel": "v1",
    "datasetStatus": "READY",
    "datasetCode": "first_limit_pullback"
  },
  {
    "conclusionId": 210002,
    "conclusionStatus": "DRAFT",
    "conclusionType": "SUPPORTED",
    "title": "首板换手率与未来五日收益的关系 — 自动结论（SUPPORTED）",
    "hypothesisId": null,
    "conclusionHead": "假设：「(未登记假设陈述)」\n\n判定：**在预设规则下支持该假设**（样本、效应量、统计量、方向稳定性四项均达标）。\n\n关键量：T+1 未来收益均值（1127 个样本） = 0.0106；p = 0.0000；t = 4.8895；样本 1",
    "experimentId": 180001,
    "experimentName": "首板换手率与未来五日收益的关系",
    "experimentStatus": "COMPLETED",
    "datasetVersionId": 390001,
    "datasetLabel": "v1",
    "datasetStatus": "READY",
    "datasetCode": "first_limit_pullback"
  },
  {
    "conclusionId": 270001,
    "conclusionStatus": "DRAFT",
    "conclusionType": "SUPPORTED",
    "title": "正式数据，首板回踩与未来收益的关系 — 自动结论（SUPPORTED）",
    "hypothesisId": null,
    "conclusionHead": "假设：「(未登记假设陈述)」\n\n判定：**在预设规则下支持该假设**（样本、效应量、统计量、方向稳定性四项均达标）。\n\n关键量：窗 A（T+0..5 分段最大跌幅）第 5 档 − 第 1 档 的 窗 B（T+5..20 分段收益）均值差 =",
    "experimentId": 240002,
    "experimentName": "正式数据，首板回踩与未来收益的关系",
    "experimentStatus": "COMPLETED",
    "datasetVersionId": 390002,
    "datasetLabel": "v2",
    "datasetStatus": "READY",
    "datasetCode": "first_limit_pullback"
  },
  {
    "conclusionId": 300001,
    "conclusionStatus": "DRAFT",
    "conclusionType": "SUPPORTED",
    "title": "正式数据，首板回踩与未来收益的关系 — 自动结论（SUPPORTED）",
    "hypothesisId": null,
    "conclusionHead": "假设：「(未登记假设陈述)」\n\n判定：**在预设规则下支持该假设**（样本、效应量、统计量、方向稳定性四项均达标）。\n\n关键量：条件组 − 全样本的 future_return_20d 均值差 = 0.0390；p = 0.0000；t =",
    "experimentId": 240002,
    "experimentName": "正式数据，首板回踩与未来收益的关系",
    "experimentStatus": "COMPLETED",
    "datasetVersionId": 390002,
    "datasetLabel": "v2",
    "datasetStatus": "READY",
    "datasetCode": "first_limit_pullback"
  },
  {
    "conclusionId": 330001,
    "conclusionStatus": "DRAFT",
    "conclusionType": "SUPPORTED",
    "title": "正式数据，首板回踩与未来收益的关系 — 自动结论（SUPPORTED）",
    "hypothesisId": null,
    "conclusionHead": "假设：「(未登记假设陈述)」\n\n判定：**在预设规则下支持该假设**（样本、效应量、统计量、方向稳定性四项均达标）。\n\n关键量：条件组 − 全样本的 future_return_20d 均值差 = 0.0390；p = 0.0000；t =",
    "experimentId": 240002,
    "experimentName": "正式数据，首板回踩与未来收益的关系",
    "experimentStatus": "COMPLETED",
    "datasetVersionId": 390002,
    "datasetLabel": "v2",
    "datasetStatus": "READY",
    "datasetCode": "first_limit_pullback"
  }
]
```

## 4. 真实 evidenceJson 形状（逐条：顶层键 + primaryAnalysis + contributingAnalyses 数量 + 旧键 analyses）

```json
{
  "conclusionId": 180001,
  "topLevelKeys": [
    "disclaimer",
    "policy",
    "hypothesisId",
    "hypothesisStatement",
    "primaryAnalysis",
    "primarySelectionRule",
    "contributingAnalyses",
    "ruleTrace",
    "confidenceBasis",
    "confidenceIsNotPValue"
  ],
  "hasPrimaryAnalysis": true,
  "primaryAnalysis": {
    "analysisId": 240001,
    "analysisType": "QUANTILE",
    "effectLabel": "Q10 − Q1 的 future_return_5d 均值差",
    "effect": -0.030784914547101534,
    "pValue": 0.09298526652520334,
    "tStat": -1.6798561131372838,
    "sampleCount": 1065,
    "minGroupSampleCount": 106,
    "groupCount": 10,
    "directionConsistency": 0.6666666666666666
  },
  "contributingAnalysesCount": 7,
  "contributingAnalysesHead": [
    {
      "analysisId": 240001,
      "analysisType": "QUANTILE",
      "effect": -0.030784914547101534,
      "effectLabel": "Q10 − Q1 的 future_return_5d 均值差",
      "pValue": 0.09298526652520334,
      "sampleCount": 1065,
      "notes": [
        "group(v) = 1 + |{k : v > percentile(feature, k/G)}|；相同特征值不劈开分组。",
        "SPREAD_TOP_BOTTOM = mean(最高分位组) − mean(最低分位组)。",
        "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验；未校正多重比较与重叠视界，仅作研究辅助。",
        "65 个样本因特征或结果缺失被排除（缺失不冒充有效样本）。"
      ]
    },
    {
      "analysisId": 240002,
      "analysisType": "QUANTILE",
      "effect": 0.05269854395617217,
      "effectLabel": "Q10 − Q1 的 future_return_5d 均值差",
      "pValue": 0.0010961731029890398,
      "sampleCount": 1065,
      "notes": [
        "group(v) = 1 + |{k : v > percentile(feature, k/G)}|；相同特征值不劈开分组。",
        "SPREAD_TOP_BOTTOM = mean(最高分位组) − mean(最低分位组)。",
        "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验；未校正多重比较与重叠视界，仅作研究辅助。",
        "65 个样本因特征或结果缺失被排除（缺失不冒充有效样本）。"
      ]
    },
    {
      "analysisId": 240003,
      "analysisType": "CONDITIONAL",
      "effect": -0.017658209679783286,
      "effectLabel": "条件组 − 全样本的 future_return_10d 均值差",
      "pValue": 0.14343387225540982,
      "sampleCount": 832,
      "notes": [
        "DIFFERENCE = mean(条件样本) − mean(全样本)。",
        "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
        "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
      ]
    }
  ],
  "legacyAnalysesKey": null,
  "ruleTraceCount": 4,
  "policy": {
    "alpha": 0.05,
    "materialityAbs": 0.005,
    "minSampleCount": 30,
    "stabilityMinConsistentRatio": 0.6,
    "strongSampleMultiple": 2
  },
  "confidenceIsNotPValue": true,
  "disclaimerLen": 85
}
```

```json
{
  "conclusionId": 180002,
  "topLevelKeys": [
    "disclaimer",
    "policy",
    "hypothesisId",
    "hypothesisStatement",
    "primaryAnalysis",
    "primarySelectionRule",
    "contributingAnalyses",
    "ruleTrace",
    "confidenceBasis",
    "confidenceIsNotPValue"
  ],
  "hasPrimaryAnalysis": true,
  "primaryAnalysis": {
    "analysisId": 240008,
    "analysisType": "EVENT_STUDY",
    "effectLabel": "T+2 未来收益均值（1127 个样本）",
    "effect": 0.01473610099951632,
    "pValue": 0.00001644494034969135,
    "tStat": 4.308547238567558,
    "sampleCount": 1130,
    "minGroupSampleCount": 581,
    "groupCount": 9,
    "directionConsistency": 1
  },
  "contributingAnalysesCount": 1,
  "contributingAnalysesHead": [
    {
      "analysisId": 240008,
      "analysisType": "EVENT_STUDY",
      "effect": 0.01473610099951632,
      "effectLabel": "T+2 未来收益均值（1127 个样本）",
      "pValue": 0.00001644494034969135,
      "sampleCount": 1130,
      "notes": [
        "主视界 = 样本数最多的视界（并列时取视界更大者）；选择规则已写死在代码里并写入证据，非事后挑选。",
        "T_STAT / P_VALUE 使用 Newey-West HAC 稳健统计量 + 正态近似 p 值；事件样本存在重叠视界，独立性假设不严格成立，仅作研究辅助。",
        "时间维度仅实现 Dataset 真实具备的「到突破天数」（outcome.daysToBreakout）；time_to_target / time_to_stop 需要逐日触价与止盈止损规则，Dataset 未定义，故不实现。",
        "T+1：Dataset 未提供 max_return_1d / min_return_1d / max_drawdown_1d / is_breakout_1d / days_to_breakout_1d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+1 的收益序列来自 path），故不输出对应指标，不虚构。",
        "T+2：Dataset 未提供 max_return_2d / min_return_2d / max_drawdown_2d / is_breakout_2d / days_to_breakout_2d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+2 的收益序列来自 path），故不输出对应指标，不虚构。",
        "T+3：Dataset 未提供 max_return_3d / min_return_3d / max_drawdown_3d / is_breakout_3d / days_to_breakout_3d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+3 的收益序列来自 path），故不输出对应指标，不虚构。",
        "T+4：Dataset 未提供 max_return_4d / min_return_4d / max_drawdown_4d / is_breakout_4d / days_to_breakout_4d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+4 的收益序列来自 path），故不输出对应指标，不虚构。",
        "T+6：Dataset 未提供 max_return_6d / min_return_6d / max_drawdown_6d / is_breakout_6d / days_to_breakout_6d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+6 的收益序列来自 path），故不输出对应指标，不虚构。",
        "T+8：Dataset 未提供 max_return_8d / min_return_8d / max_drawdown_8d / is_breakout_8d / days_to_breakout_8d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+8 的收益序列来自 path），故不输出对应指标，不虚构。",
        "T+15：Dataset 未提供 max_return_15d / min_return_15d / max_drawdown_15d / is_breakout_15d / days_to_breakout_15d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+15 的收益序列来自 path），故不输出对应指标，不虚构。"
      ]
    }
  ],
  "legacyAnalysesKey": null,
  "ruleTraceCount": 4,
  "policy": {
    "alpha": 0.05,
    "materialityAbs": 0.005,
    "minSampleCount": 30,
    "stabilityMinConsistentRatio": 0.6,
    "strongSampleMultiple": 2
  },
  "confidenceIsNotPValue": true,
  "disclaimerLen": 85
}
```

```json
{
  "conclusionId": 210001,
  "topLevelKeys": [
    "disclaimer",
    "policy",
    "hypothesisId",
    "hypothesisStatement",
    "primaryAnalysis",
    "primarySelectionRule",
    "contributingAnalyses",
    "ruleTrace",
    "confidenceBasis",
    "confidenceIsNotPValue"
  ],
  "hasPrimaryAnalysis": true,
  "primaryAnalysis": {
    "analysisId": 270001,
    "analysisType": "QUANTILE",
    "effectLabel": "Q10 − Q1 的 future_return_5d 均值差",
    "effect": -0.030784914547101534,
    "pValue": 0.09298526652520334,
    "tStat": -1.6798561131372838,
    "sampleCount": 1065,
    "minGroupSampleCount": 106,
    "groupCount": 10,
    "directionConsistency": 0.6666666666666666
  },
  "contributingAnalysesCount": 1,
  "contributingAnalysesHead": [
    {
      "analysisId": 270001,
      "analysisType": "QUANTILE",
      "effect": -0.030784914547101534,
      "effectLabel": "Q10 − Q1 的 future_return_5d 均值差",
      "pValue": 0.09298526652520334,
      "sampleCount": 1065,
      "notes": [
        "group(v) = 1 + |{k : v > percentile(feature, k/G)}|；相同特征值不劈开分组。",
        "SPREAD_TOP_BOTTOM = mean(最高分位组) − mean(最低分位组)。",
        "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验；未校正多重比较与重叠视界，仅作研究辅助。",
        "65 个样本因特征或结果缺失被排除（缺失不冒充有效样本）。"
      ]
    }
  ],
  "legacyAnalysesKey": null,
  "ruleTraceCount": 4,
  "policy": {
    "alpha": 0.05,
    "materialityAbs": 0.005,
    "minSampleCount": 30,
    "stabilityMinConsistentRatio": 0.6,
    "strongSampleMultiple": 2
  },
  "confidenceIsNotPValue": true,
  "disclaimerLen": 85
}
```

```json
{
  "conclusionId": 210002,
  "topLevelKeys": [
    "disclaimer",
    "policy",
    "hypothesisId",
    "hypothesisStatement",
    "primaryAnalysis",
    "primarySelectionRule",
    "contributingAnalyses",
    "ruleTrace",
    "confidenceBasis",
    "confidenceIsNotPValue"
  ],
  "hasPrimaryAnalysis": true,
  "primaryAnalysis": {
    "analysisId": 270007,
    "analysisType": "EVENT_STUDY",
    "effectLabel": "T+1 未来收益均值（1127 个样本）",
    "effect": 0.010591727318356668,
    "pValue": 0.000001012509648790072,
    "tStat": 4.889470256888688,
    "sampleCount": 1130,
    "minGroupSampleCount": 319,
    "groupCount": 5,
    "directionConsistency": 1
  },
  "contributingAnalysesCount": 1,
  "contributingAnalysesHead": [
    {
      "analysisId": 270007,
      "analysisType": "EVENT_STUDY",
      "effect": 0.010591727318356668,
      "effectLabel": "T+1 未来收益均值（1127 个样本）",
      "pValue": 0.000001012509648790072,
      "sampleCount": 1130,
      "notes": [
        "主视界 = 样本数最多的视界（并列时取视界更大者）；选择规则已写死在代码里并写入证据，非事后挑选。",
        "T_STAT / P_VALUE 使用 Newey-West HAC 稳健统计量 + 正态近似 p 值；事件样本存在重叠视界，独立性假设不严格成立，仅作研究辅助。",
        "时间维度仅实现 Dataset 真实具备的「到突破天数」（outcome.daysToBreakout）；time_to_target / time_to_stop 需要逐日触价与止盈止损规则，Dataset 未定义，故不实现。",
        "T+1：Dataset 未提供 max_return_1d / min_return_1d / max_drawdown_1d / is_breakout_1d / days_to_breakout_1d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+1 的收益序列来自 path），故不输出对应指标，不虚构。",
        "T+3：Dataset 未提供 max_return_3d / min_return_3d / max_drawdown_3d / is_breakout_3d / days_to_breakout_3d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+3 的收益序列来自 path），故不输出对应指标，不虚构。"
      ]
    }
  ],
  "legacyAnalysesKey": null,
  "ruleTraceCount": 4,
  "policy": {
    "alpha": 0.05,
    "materialityAbs": 0.005,
    "minSampleCount": 30,
    "stabilityMinConsistentRatio": 0.6,
    "strongSampleMultiple": 2
  },
  "confidenceIsNotPValue": true,
  "disclaimerLen": 85
}
```

```json
{
  "conclusionId": 270001,
  "topLevelKeys": [
    "disclaimer",
    "policy",
    "hypothesisId",
    "hypothesisStatement",
    "primaryAnalysis",
    "primarySelectionRule",
    "contributingAnalyses",
    "ruleTrace",
    "confidenceBasis",
    "confidenceIsNotPValue"
  ],
  "hasPrimaryAnalysis": true,
  "primaryAnalysis": {
    "analysisId": 330001,
    "analysisType": "SEGMENT_RELATION",
    "effectLabel": "窗 A（T+0..5 分段最大跌幅）第 5 档 − 第 1 档 的 窗 B（T+5..20 分段收益）均值差",
    "effect": -0.018022159588986744,
    "pValue": 0.000005572819082200198,
    "tStat": -4.542184582850737,
    "sampleCount": 22944,
    "minGroupSampleCount": 4587,
    "groupCount": 5,
    "directionConsistency": 0.75
  },
  "contributingAnalysesCount": 1,
  "contributingAnalysesHead": [
    {
      "analysisId": 330001,
      "analysisType": "SEGMENT_RELATION",
      "effect": -0.018022159588986744,
      "effectLabel": "窗 A（T+0..5 分段最大跌幅）第 5 档 − 第 1 档 的 窗 B（T+5..20 分段收益）均值差",
      "pValue": 0.000005572819082200198,
      "sampleCount": 22944,
      "notes": [
        "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
        "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
        "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
        "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
        "本分析只给**统计关系**：窗 A 统计量虽在 T+5 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
        "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
        "1034 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
      ]
    }
  ],
  "legacyAnalysesKey": null,
  "ruleTraceCount": 4,
  "policy": {
    "alpha": 0.05,
    "materialityAbs": 0.005,
    "minSampleCount": 30,
    "stabilityMinConsistentRatio": 0.6,
    "strongSampleMultiple": 2
  },
  "confidenceIsNotPValue": true,
  "disclaimerLen": 85
}
```

```json
{
  "conclusionId": 300001,
  "topLevelKeys": [
    "disclaimer",
    "policy",
    "hypothesisId",
    "hypothesisStatement",
    "primaryAnalysis",
    "primarySelectionRule",
    "contributingAnalyses",
    "ruleTrace",
    "confidenceBasis",
    "confidenceIsNotPValue"
  ],
  "hasPrimaryAnalysis": true,
  "primaryAnalysis": {
    "analysisId": 360001,
    "analysisType": "CONDITIONAL",
    "effectLabel": "条件组 − 全样本的 future_return_20d 均值差",
    "effect": 0.038950159772887606,
    "pValue": 0,
    "tStat": 16.396856329822153,
    "sampleCount": 23033,
    "minGroupSampleCount": 16158,
    "groupCount": 2,
    "directionConsistency": null
  },
  "contributingAnalysesCount": 2,
  "contributingAnalysesHead": [
    {
      "analysisId": 360001,
      "analysisType": "CONDITIONAL",
      "effect": 0.038950159772887606,
      "effectLabel": "条件组 − 全样本的 future_return_20d 均值差",
      "pValue": 0,
      "sampleCount": 23033,
      "notes": [
        "DIFFERENCE = mean(条件样本) − mean(全样本)。",
        "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
        "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
      ]
    },
    {
      "analysisId": 360002,
      "analysisType": "DESCRIPTIVE",
      "effect": null,
      "effectLabel": "描述性统计（无主效应）",
      "pValue": null,
      "sampleCount": 23978,
      "notes": [
        "DESCRIPTIVE 只描述分布，不做任何假设检验，因此不产出结论方向。",
        "变量 volume_ratio_1d 缺失率 0.25%（缺失值不参与统计）",
        "变量 volume_ratio_2d 缺失率 0.35%（缺失值不参与统计）",
        "变量 volume_ratio_3d 缺失率 0.39%（缺失值不参与统计）",
        "变量 volume_ratio_4d 缺失率 0.68%（缺失值不参与统计）",
        "变量 volume_ratio_5d 缺失率 0.95%（缺失值不参与统计）"
      ]
    }
  ],
  "legacyAnalysesKey": null,
  "ruleTraceCount": 4,
  "policy": {
    "alpha": 0.05,
    "materialityAbs": 0.005,
    "minSampleCount": 30,
    "stabilityMinConsistentRatio": 0.6,
    "strongSampleMultiple": 2
  },
  "confidenceIsNotPValue": true,
  "disclaimerLen": 85
}
```

```json
{
  "conclusionId": 330001,
  "topLevelKeys": [
    "disclaimer",
    "policy",
    "hypothesisId",
    "hypothesisStatement",
    "primaryAnalysis",
    "primarySelectionRule",
    "contributingAnalyses",
    "ruleTrace",
    "confidenceBasis",
    "confidenceIsNotPValue"
  ],
  "hasPrimaryAnalysis": true,
  "primaryAnalysis": {
    "analysisId": 390001,
    "analysisType": "CONDITIONAL",
    "effectLabel": "条件组 − 全样本的 future_return_20d 均值差",
    "effect": 0.038950159772887606,
    "pValue": 0,
    "tStat": 16.396856329822153,
    "sampleCount": 23033,
    "minGroupSampleCount": 16158,
    "groupCount": 2,
    "directionConsistency": null
  },
  "contributingAnalysesCount": 5,
  "contributingAnalysesHead": [
    {
      "analysisId": 390001,
      "analysisType": "CONDITIONAL",
      "effect": 0.038950159772887606,
      "effectLabel": "条件组 − 全样本的 future_return_20d 均值差",
      "pValue": 0,
      "sampleCount": 23033,
      "notes": [
        "DIFFERENCE = mean(条件样本) − mean(全样本)。",
        "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
        "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
      ]
    },
    {
      "analysisId": 390002,
      "analysisType": "CONDITIONAL",
      "effect": -0.09501641759591181,
      "effectLabel": "条件组 − 全样本的 future_return_20d 均值差",
      "pValue": 0,
      "sampleCount": 23033,
      "notes": [
        "DIFFERENCE = mean(条件样本) − mean(全样本)。",
        "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
        "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
      ]
    },
    {
      "analysisId": 390003,
      "analysisType": "SEGMENT_RELATION",
      "effect": -0.018022159588986744,
      "effectLabel": "窗 A（T+0..5 分段最大跌幅）第 5 档 − 第 1 档 的 窗 B（T+5..20 分段收益）均值差",
      "pValue": 0.000005572819082200198,
      "sampleCount": 22944,
      "notes": [
        "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
        "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
        "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
        "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
        "本分析只给**统计关系**：窗 A 统计量虽在 T+5 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
        "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
        "1034 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
      ]
    }
  ],
  "legacyAnalysesKey": null,
  "ruleTraceCount": 4,
  "policy": {
    "alpha": 0.05,
    "materialityAbs": 0.005,
    "minSampleCount": 30,
    "stabilityMinConsistentRatio": 0.6,
    "strongSampleMultiple": 2
  },
  "confidenceIsNotPValue": true,
  "disclaimerLen": 85
}
```

## 5. evidence 里引用的 analysisId 是否真能反查到 runId（两跳解析可行性）

```json
[
  {
    "analysisId": 240001,
    "runId": 270001,
    "analysisType": "QUANTILE",
    "experimentId": 180001,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 240002,
    "runId": 270001,
    "analysisType": "QUANTILE",
    "experimentId": 180001,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 240003,
    "runId": 270001,
    "analysisType": "CONDITIONAL",
    "experimentId": 180001,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 240004,
    "runId": 270001,
    "analysisType": "CONDITIONAL",
    "experimentId": 180001,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 240005,
    "runId": 270001,
    "analysisType": "CONDITIONAL",
    "experimentId": 180001,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 240006,
    "runId": 270001,
    "analysisType": "CONDITIONAL",
    "experimentId": 180001,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 240007,
    "runId": 270001,
    "analysisType": "CONDITIONAL",
    "experimentId": 180001,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 240008,
    "runId": 270002,
    "analysisType": "EVENT_STUDY",
    "experimentId": 180001,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 270001,
    "runId": 300001,
    "analysisType": "QUANTILE",
    "experimentId": 180001,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 270007,
    "runId": 330002,
    "analysisType": "EVENT_STUDY",
    "experimentId": 180001,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 270008,
    "runId": 330003,
    "analysisType": "EVENT_STUDY",
    "experimentId": 240002,
    "runStatus": "FAILED"
  },
  {
    "analysisId": 330001,
    "runId": 390001,
    "analysisType": "SEGMENT_RELATION",
    "experimentId": 240002,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 360001,
    "runId": 420001,
    "analysisType": "CONDITIONAL",
    "experimentId": 240002,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 360002,
    "runId": 420001,
    "analysisType": "DESCRIPTIVE",
    "experimentId": 240002,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 390001,
    "runId": 450001,
    "analysisType": "CONDITIONAL",
    "experimentId": 240002,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 390002,
    "runId": 450001,
    "analysisType": "CONDITIONAL",
    "experimentId": 240002,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 390003,
    "runId": 450001,
    "analysisType": "SEGMENT_RELATION",
    "experimentId": 240002,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 390004,
    "runId": 450001,
    "analysisType": "DESCRIPTIVE",
    "experimentId": 240002,
    "runStatus": "COMPLETED"
  },
  {
    "analysisId": 390005,
    "runId": 450001,
    "analysisType": "CONDITIONAL",
    "experimentId": 240002,
    "runStatus": "COMPLETED"
  }
]
```

## 6. 真实结论正文长度（决定 description 是否会被截断）

```json
[
  {
    "id": 180001,
    "titleLen": 43,
    "bodyLen": 439
  },
  {
    "id": 180002,
    "titleLen": 33,
    "bodyLen": 428
  },
  {
    "id": 210001,
    "titleLen": 43,
    "bodyLen": 439
  },
  {
    "id": 210002,
    "titleLen": 33,
    "bodyLen": 428
  },
  {
    "id": 270001,
    "titleLen": 35,
    "bodyLen": 468
  },
  {
    "id": 300001,
    "titleLen": 35,
    "bodyLen": 436
  },
  {
    "id": 330001,
    "titleLen": 35,
    "bodyLen": 436
  }
]
```
