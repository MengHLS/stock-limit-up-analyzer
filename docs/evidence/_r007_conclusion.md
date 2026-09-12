[
  {
    "id": 390003,
    "experimentId": 240002,
    "hypothesisId": null,
    "conclusionType": "REJECTED",
    "title": "正式数据，首板回踩与未来收益的关系 — 自动结论（REJECTED）",
    "conclusion": "假设：「(未登记假设陈述)」\n\n判定：**未观察到达到预设最小实际效应的系统性差异**（|效应| < 0.005）。\n\n关键量：条件组 − 全样本的 segment_return_2_7d 均值差 = -0.0016；p = 0.3831；t = -0.8721；样本 23604（最小分组 3155）；\n\n判定依据（按顺序短路）：\n1. [通过] R2_样本达标 —— 总样本 23604（门槛 30），最小分组样本 3155（门槛 30）\n2. [未通过] R3_效应达到最小实际阈值 —— |效应| = 0.0016，阈值 0.005\n3. [未通过] R4_统计量达标 —— p = 0.3831，alpha = 0.05\n4. [通过] R5_方向稳定 —— 无方向一致性信息（不构成否决条件）\n\n⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。",
    "evidence": {
      "disclaimer": "⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。",
      "policy": {
        "alpha": 0.05,
        "materialityAbs": 0.005,
        "minSampleCount": 30,
        "stabilityMinConsistentRatio": 0.6,
        "strongSampleMultiple": 2
      },
      "hypothesisId": null,
      "hypothesisStatement": "(未登记假设陈述)",
      "primaryAnalysis": {
        "analysisId": 450011,
        "analysisType": "CONDITIONAL",
        "effectLabel": "条件组 − 全样本的 segment_return_2_7d 均值差",
        "effect": -0.0015963055958837504,
        "pValue": 0.3831429778003468,
        "tStat": -0.8721197436276932,
        "sampleCount": 23604,
        "minGroupSampleCount": 3155,
        "groupCount": 2,
        "directionConsistency": null
      },
      "primarySelectionRule": "按 QUANTILE → CONDITIONAL → EVENT_STUDY → STABILITY → SEGMENT_RELATION 的固定优先级选择主分析（不按效应大小挑选，避免选择性报告）",
      "contributingAnalyses": [
        {
          "analysisId": 450001,
          "analysisType": "SEGMENT_RELATION",
          "effect": 0.02929340467915305,
          "effectLabel": "窗 A（T+0..1 分段收益）第 5 档 − 第 1 档 的 窗 B（T+1..6 分段收益）均值差",
          "pValue": 0,
          "sampleCount": 23668,
          "notes": [
            "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
            "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
            "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
            "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
            "本分析只给**统计关系**：窗 A 统计量虽在 T+1 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
            "310 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
          ]
        },
        {
          "analysisId": 450002,
          "analysisType": "SEGMENT_RELATION",
          "effect": 0.005776177906280374,
          "effectLabel": "窗 A（T+0..2 分段收益）第 5 档 − 第 1 档 的 窗 B（T+2..7 分段收益）均值差",
          "pValue": 0.04156824866991382,
          "sampleCount": 23604,
          "notes": [
            "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
            "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
            "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
            "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
            "本分析只给**统计关系**：窗 A 统计量虽在 T+2 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
            "374 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
          ]
        },
        {
          "analysisId": 450003,
          "analysisType": "SEGMENT_RELATION",
          "effect": -0.010634433944011278,
          "effectLabel": "窗 A（T+0..3 分段收益）第 5 档 − 第 1 档 的 窗 B（T+3..8 分段收益）均值差",
          "pValue": 0.00009770830620370319,
          "sampleCount": 23564,
          "notes": [
            "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
            "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
            "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
            "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
            "本分析只给**统计关系**：窗 A 统计量虽在 T+3 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
            "414 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
          ]
        },
        {
          "analysisId": 450004,
          "analysisType": "SEGMENT_RELATION",
          "effect": -0.009381028189696395,
          "effectLabel": "窗 A（T+0..4 分段收益）第 5 档 − 第 1 档 的 窗 B（T+4..9 分段收益）均值差",
          "pValue": 0.00037298098878402186,
          "sampleCount": 23502,
          "notes": [
            "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
            "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
            "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
            "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
            "本分析只给**统计关系**：窗 A 统计量虽在 T+4 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
            "476 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
          ]
        },
        {
          "analysisId": 450005,
          "analysisType": "SEGMENT_RELATION",
          "effect": -0.008608377987299132,
          "effectLabel": "窗 A（T+0..5 分段收益）第 5 档 − 第 1 档 的 窗 B（T+5..10 分段收益）均值差",
          "pValue": 0.0007652789576026997,
          "sampleCount": 23479,
          "notes": [
            "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
            "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
            "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
            "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
            "本分析只给**统计关系**：窗 A 统计量虽在 T+5 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
            "499 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
          ]
        },
        {
          "analysisId": 450006,
          "analysisType": "SEGMENT_RELATION",
          "effect": 0.026858849232748408,
          "effectLabel": "窗 A（T+0..1 分段收益）第 5 档 − 第 1 档 的 窗 B（T+1..11 分段收益）均值差",
          "pValue": 5.928146862288486e-12,
          "sampleCount": 23460,
          "notes": [
            "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
            "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
            "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
            "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
            "本分析只给**统计关系**：窗 A 统计量虽在 T+1 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
            "518 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
          ]
        },
        {
          "analysisId": 450007,
          "analysisType": "SEGMENT_RELATION",
          "effect": 0.0026186527708015276,
          "effectLabel": "窗 A（T+0..2 分段收益）第 5 档 − 第 1 档 的 窗 B（T+2..12 分段收益）均值差",
          "pValue": 0.4784648150916311,
          "sampleCount": 23380,
          "notes": [
            "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
            "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
            "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
            "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
            "本分析只给**统计关系**：窗 A 统计量虽在 T+2 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
            "598 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
          ]
        },
        {
          "analysisId": 450008,
          "analysisType": "SEGMENT_RELATION",
          "effect": -0.014703108616096576,
          "effectLabel": "窗 A（T+0..3 分段收益）第 5 档 − 第 1 档 的 窗 B（T+3..13 分段收益）均值差",
          "pValue": 0.00004795457349215937,
          "sampleCount": 23344,
          "notes": [
            "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
            "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
            "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
            "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
            "本分析只给**统计关系**：窗 A 统计量虽在 T+3 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
            "634 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
          ]
        },
        {
          "analysisId": 450009,
          "analysisType": "SEGMENT_RELATION",
          "effect": -0.018910783434142098,
          "effectLabel": "窗 A（T+0..4 分段收益）第 5 档 − 第 1 档 的 窗 B（T+4..14 分段收益）均值差",
          "pValue": 6.457762369294073e-8,
          "sampleCount": 23272,
          "notes": [
            "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
            "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
            "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
            "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
            "本分析只给**统计关系**：窗 A 统计量虽在 T+4 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
            "706 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
          ]
        },
        {
          "analysisId": 450010,
          "analysisType": "SEGMENT_RELATION",
          "effect": -0.014615603251551547,
          "effectLabel": "窗 A（T+0..5 分段收益）第 5 档 − 第 1 档 的 窗 B（T+5..15 分段收益）均值差",
          "pValue": 0.000024879198804672598,
          "sampleCount": 23196,
          "notes": [
            "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
            "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
            "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
            "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
            "本分析只给**统计关系**：窗 A 统计量虽在 T+5 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
            "782 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
          ]
        },
        {
          "analysisId": 450011,
          "analysisType": "CONDITIONAL",
          "effect": -0.0015963055958837504,
          "effectLabel": "条件组 − 全样本的 segment_return_2_7d 均值差",
          "pValue": 0.3831429778003468,
          "sampleCount": 23604,
          "notes": [
            "DIFFERENCE = mean(条件样本) − mean(全样本)。",
            "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
          ]
        },
        {
          "analysisId": 450012,
          "analysisType": "CONDITIONAL",
          "effect": 0.003663642278505231,
          "effectLabel": "条件组 − 全样本的 segment_return_2_7d 均值差",
          "pValue": 0.05821088335870339,
          "sampleCount": 23604,
          "notes": [
            "DIFFERENCE = mean(条件样本) − mean(全样本)。",
            "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
          ]
        },
        {
          "analysisId": 450013,
          "analysisType": "CONDITIONAL",
          "effect": 0.001893572692232389,
          "effectLabel": "条件组 − 全样本的 segment_return_2_7d 均值差",
          "pValue": 0.38170888947861337,
          "sampleCount": 23604,
          "notes": [
            "DIFFERENCE = mean(条件样本) − mean(全样本)。",
            "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
          ]
        },
        {
          "analysisId": 450014,
          "analysisType": "CONDITIONAL",
          "effect": -0.00048124514066523547,
          "effectLabel": "条件组 − 全样本的 segment_return_2_7d 均值差",
          "pValue": 0.8635092053400446,
          "sampleCount": 23604,
          "notes": [
            "DIFFERENCE = mean(条件样本) − mean(全样本)。",
            "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
          ]
        },
        {
          "analysisId": 450015,
          "analysisType": "CONDITIONAL",
          "effect": -0.0109252072437308,
          "effectLabel": "条件组 − 全样本的 segment_return_2_7d 均值差",
          "pValue": 0.00006076916037045521,
          "sampleCount": 23604,
          "notes": [
            "DIFFERENCE = mean(条件样本) − mean(全样本)。",
            "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
          ]
        },
        {
          "analysisId": 450016,
          "analysisType": "CONDITIONAL",
          "effect": 0.0021739973913570483,
          "effectLabel": "条件组 − 全样本的 segment_return_3_8d 均值差",
          "pValue": 0.28134606127956685,
          "sampleCount": 23564,
          "notes": [
            "DIFFERENCE = mean(条件样本) − mean(全样本)。",
            "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
          ]
        },
        {
          "analysisId": 450017,
          "analysisType": "CONDITIONAL",
          "effect": 0.002236888498965885,
          "effectLabel": "条件组 − 全样本的 segment_return_3_8d 均值差",
          "pValue": 0.2591011948913602,
          "sampleCount": 23564,
          "notes": [
            "DIFFERENCE = mean(条件样本) − mean(全样本)。",
            "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
          ]
        },
        {
          "analysisId": 450018,
          "analysisType": "CONDITIONAL",
          "effect": 0.004081872347024706,
          "effectLabel": "条件组 − 全样本的 segment_return_3_8d 均值差",
          "pValue": 0.05502693915793122,
          "sampleCount": 23564,
          "notes": [
            "DIFFERENCE = mean(条件样本) − mean(全样本)。",
            "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
          ]
        },
        {
          "analysisId": 450019,
          "analysisType": "CONDITIONAL",
          "effect": 0.006411812688136286,
          "effectLabel": "条件组 − 全样本的 segment_return_3_8d 均值差",
          "pValue": 0.010714940674067641,
          "sampleCount": 23564,
          "notes": [
            "DIFFERENCE = mean(条件样本) − mean(全样本)。",
            "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
          ]
        },
        {
          "analysisId": 450020,
          "analysisType": "CONDITIONAL",
          "effect": -0.0001952186657923436,
          "effectLabel": "条件组 − 全样本的 segment_return_3_8d 均值差",
          "pValue": 0.9253267971299897,
          "sampleCount": 23564,
          "notes": [
            "DIFFERENCE = mean(条件样本) − mean(全样本)。",
            "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
          ]
        },
        {
          "analysisId": 450021,
          "analysisType": "SEGMENT_RELATION",
          "effect": 0.059323473646566025,
          "effectLabel": "窗 A（T+0..2 分段收益）第 5 档 − 第 1 档 的 窗 B（T+2..7 分段最大有利偏移）均值差",
          "pValue": 0,
          "sampleCount": 23580,
          "notes": [
            "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
            "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
            "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
            "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
            "本分析只给**统计关系**：窗 A 统计量虽在 T+2 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
            "398 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
          ]
        },
        {
          "analysisId": 450022,
          "analysisType": "SEGMENT_RELATION",
          "effect": -0.014011452781045798,
          "effectLabel": "窗 A（T+0..2 分段收益）第 5 档 − 第 1 档 的 窗 B（T+2..7 分段最大跌幅）均值差",
          "pValue": 0,
          "sampleCount": 23580,
          "notes": [
            "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
            "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
            "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
            "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
            "本分析只给**统计关系**：窗 A 统计量虽在 T+2 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
            "窗 B 口径为「分段最大跌幅」，是跌幅类极值口径 —— 「取值 > 0 的占比」不构成通常意义上的胜率，故不产出 WIN_RATE（列出来只会诱导错误解读）。另需注意：该口径**并非恒为负** —— 取值窗 [T+3, T+7] 不含锚点日T+2，价格整段上行时窗内最低收盘仍可能高于锚点收盘。",
            "398 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
          ]
        },
        {
          "analysisId": 450023,
          "analysisType": "SEGMENT_RELATION",
          "effect": 0.04359073339880083,
          "effectLabel": "窗 A（T+0..3 分段收益）第 5 档 − 第 1 档 的 窗 B（T+3..8 分段最大有利偏移）均值差",
          "pValue": 0,
          "sampleCount": 23544,
          "notes": [
            "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
            "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
            "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
            "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
            "本分析只给**统计关系**：窗 A 统计量虽在 T+3 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
            "434 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
          ]
        },
        {
          "analysisId": 450024,
          "analysisType": "SEGMENT_RELATION",
          "effect": -0.026575808241840096,
          "effectLabel": "窗 A（T+0..3 分段收益）第 5 档 − 第 1 档 的 窗 B（T+3..8 分段最大跌幅）均值差",
          "pValue": 0,
          "sampleCount": 23544,
          "notes": [
            "band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。",
            "配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。",
            "窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。",
            "SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。",
            "本分析只给**统计关系**：窗 A 统计量虽在 T+3 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。",
            "窗 B 口径为「分段最大跌幅」，是跌幅类极值口径 —— 「取值 > 0 的占比」不构成通常意义上的胜率，故不产出 WIN_RATE（列出来只会诱导错误解读）。另需注意：该口径**并非恒为负** —— 取值窗 [T+4, T+8] 不含锚点日T+3，价格整段上行时窗内最低收盘仍可能高于锚点收盘。",
            "434 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。"
          ]
        },
        {
          "analysisId": 450025,
          "analysisType": "CONDITIONAL",
          "effect": -0.006156736804824819,
          "effectLabel": "条件组 − 全样本的 segment_return_2_7d 均值差",
          "pValue": 0.0575197240527876,
          "sampleCount": 23604,
          "notes": [
            "DIFFERENCE = mean(条件样本) − mean(全样本)。",
            "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
          ]
        },
        {
          "analysisId": 450026,
          "analysisType": "CONDITIONAL",
          "effect": -0.0009855256866595002,
          "effectLabel": "条件组 − 全样本的 segment_return_2_7d 均值差",
          "pValue": 0.565230736807997,
          "sampleCount": 23604,
          "notes": [
            "DIFFERENCE = mean(条件样本) − mean(全样本)。",
            "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
          ]
        },
        {
          "analysisId": 450027,
          "analysisType": "CONDITIONAL",
          "effect": 0.0006504671398880214,
          "effectLabel": "条件组 − 全样本的 segment_return_2_7d 均值差",
          "pValue": 0.7792176401882334,
          "sampleCount": 23604,
          "notes": [
            "DIFFERENCE = mean(条件样本) − mean(全样本)。",
            "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
          ]
        },
        {
          "analysisId": 450028,
          "analysisType": "CONDITIONAL",
          "effect": -0.0030579792379484445,
          "effectLabel": "条件组 − 全样本的 segment_return_2_7d 均值差",
          "pValue": 0.14261514290538635,
          "sampleCount": 23604,
          "notes": [
            "DIFFERENCE = mean(条件样本) − mean(全样本)。",
            "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
          ]
        },
        {
          "analysisId": 450029,
          "analysisType": "CONDITIONAL",
          "effect": -0.00018061769389623138,
          "effectLabel": "条件组 − 全样本的 segment_return_2_7d 均值差",
          "pValue": 0.9429350494489808,
          "sampleCount": 23604,
          "notes": [
            "DIFFERENCE = mean(条件样本) − mean(全样本)。",
            "RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。",
            "T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。"
          ]
        }
      ],
      "ruleTrace": [
        {
          "rule": "R2_样本达标",
          "passed": true,
          "detail": "总样本 23604（门槛 30），最小分组样本 3155（门槛 30）"
        },
        {
          "rule": "R3_效应达到最小实际阈值",
          "passed": false,
          "detail": "|效应| = 0.0016，阈值 0.005"
        },
        {
          "rule": "R4_统计量达标",
          "passed": false,
          "detail": "p = 0.3831，alpha = 0.05"
        },
        {
          "rule": "R5_方向稳定",
          "passed": true,
          "detail": "无方向一致性信息（不构成否决条件）"
        }
      ],
      "confidenceBasis": "基础 0.30；+0.15 样本充裕",
      "confidenceIsNotPValue": true
    },
    "confidence": 0.45,
    "status": "DRAFT",
    "createdAt": "2026-09-12T12:38:35.000Z",
    "updatedAt": "2026-09-12T12:38:35.000Z"
  }
]