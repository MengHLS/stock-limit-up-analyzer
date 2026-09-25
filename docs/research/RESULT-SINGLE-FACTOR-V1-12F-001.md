# RESULT-SINGLE-FACTOR-V1-12F-001 —— 12 个冻结因子的单因子实验（真实 Run × 12）

> 模板：**SINGLE_FACTOR_EXPERIMENT_V1**（`research-experiments/first-board-pullback/single-factor-v1`）。
> 本文所有表格数字由 12 个真实 Run 的结果信封**机械生成**（`gen_sf12_report.py`），未人工转录。
> 冻结口径：入场 T+6 开盘 / 退出 T+10 收盘（不可卖顺延，≤T+20）/ 等权全仓 / 往返成本 20 bps；
> 排名用因子**原始值**（不是桶位分）；方向与 TopN **不是运行参数**，一次 Run 输出全部 8 个组合。

## 一、结论前置

- 12 个冻结因子各跑 **1 次真实 Run**，全部 `status = COMPLETED`（见 §二）。合计 **864 个判定行**（组合级 96 + 年切片级 768），α=0.05 下假阳性期望 ≈ **43**。
- **主判据（配对日度超额）**：96 个「因子 × 组合」格子里，POSITIVE **12**、NEGATIVE **31**、INCONCLUSIVE **53**、INSUFFICIENT **0**。
- **方向性证据**：按冻结先验方向（`orientation`）判断「HIGH 与 LOW 的超额差符号」逐档一致的因子共 **9 / 12** 个。
- 🔴 全部结论都是**探索性**的：864 个判定行本身就是 n 次比较，且年切片与 8 个档位高度重叠。

## 二、交付：12 个真实 Run

| # | 你给的 code（别名） | 实际 factorCode | 因子标签 | Run ID | 状态 | durationMs | 落存储 | 逐笔产物行数 |
|---|---|---|---|---|---|---|---|---|
| 1 | `entity_height` | `bodyHeight` | 首板实体高度 | `RUN-20260925-7CE69726` | COMPLETED | 853020 | True | 126168 |
| 2 | `turnover` | `turnover` | 首板换手率 | `RUN-20260925-750667F5` | COMPLETED | 818801 | True | 126168 |
| 3 | `same_day_percentile` | `amountPercentile` | 同日成交额分位 | `RUN-20260925-50D9AABC` | COMPLETED | 823041 | True | 126168 |
| 4 | `avg_amplitude` | `meanAmplitude` | T+1..T+5 平均振幅 | `RUN-20260925-9A8C79B1` | COMPLETED | 1070388 | True | 126168 |
| 5 | `max_amplitude` | `maxAmplitude` | T+1..T+5 最大振幅 | `RUN-20260925-B987620B` | COMPLETED | 621739 | True | 126168 |
| 6 | `guard_streak` | `holdStreak` | 守涨停价 streak（收盘口径） | `RUN-20260925-8E9C5DC8` | COMPLETED | 559383 | True | 126168 |
| 7 | `volume_ratio` | `t1VolumeRatio` | T+1 成交量 ÷ T 日成交量 | `RUN-20260925-77F7A6F1` | COMPLETED | 586460 | True | 126168 |
| 8 | `limit_up_interval` | `limitGap` | 前次涨停间隔 | `RUN-20260925-9F7563E0` | COMPLETED | 567876 | True | 123638 |
| 9 | `prior_gain` | `preReturn10` | 前期涨幅 close(T-1)/close(T-10)-1 | `RUN-20260925-2F1353F6` | COMPLETED | 533619 | True | 126168 |
| 10 | `drawdown_depth` | `drawdownDepth` | T+1..T+5 回撤深度（对首板收盘） | `RUN-20260925-4DB246DD` | COMPLETED | 2031701 | True | 126168 |
| 11 | `t1_gap` | `t1OpenGap` | T+1 开盘缺口 | `RUN-20260925-1B0D7972` | COMPLETED | 541592 | True | 126168 |
| 12 | `historical_limit_up_count` | `historyLimitCount` | 历史涨停次数 | `RUN-20260925-8C7A547F` | COMPLETED | 1191239 | True | 126168 |

数据集：`first_limit_pullback` **v5**（id 660001，2019-01-01 ~ 2026-09-04，事件 73,003）。

🔴 **别名映射说明**：请求里给出的 12 个 snake_case 名称在本仓冻结因子目录中**不存在**；
目录只认驼峰 `code`。两者按顺序一一对应（上表逐行给出）。因子定义 / 桶边界 / 方向**零改动**。

| 别名 | 冻结 code | orientation（先验方向） | priorVerified | 桶数 | 冻结桶 |
|---|---|---|---|---|---|
| `entity_height` | `bodyHeight` | -1 | True | 6 | ≤0.1% / 0.1~2% / 2~4% / 4~6% / 6~8% / ≥8% |
| `turnover` | `turnover` | -1 | True | 6 | <1% / 1~2% / 2~3% / 3~5% / 5~10% / ≥10% |
| `same_day_percentile` | `amountPercentile` | -1 | True | 5 | 0~20 分位 / 20~40 分位 / 40~60 分位 / 60~80 分位 / 80~100 分位 |
| `avg_amplitude` | `meanAmplitude` | -1 | True | 5 | <2% / 2~4% / 4~6% / 6~8% / ≥8% |
| `max_amplitude` | `maxAmplitude` | -1 | True | 2 | <8% / ≥8% |
| `guard_streak` | `holdStreak` | +1 | False | 6 | 0 日 / 1 日 / 2 日 / 3 日 / 4 日 / 5 日 |
| `volume_ratio` | `t1VolumeRatio` | +1 | True | 5 | <50% / 50~80% / 80~120% / 120~200% / ≥200% |
| `limit_up_interval` | `limitGap` | +1 | False | 6 | UNKNOWN / 1~3 日 / 4~5 日 / 6~10 日 / 11~20 日 / >20 日 |
| `prior_gain` | `preReturn10` | -1 | False | 7 | <-10% / -10~-5% / -5~0% / 0~+5% / +5~+10% / +10~+20% / >+20% |
| `drawdown_depth` | `drawdownDepth` | -1 | True | 5 | 0~-2% / -2~-5% / -5~-8% / -8~-10% / <-10% |
| `t1_gap` | `t1OpenGap` | +1 | True | 5 | <-5% / -5~0% / 0~+5% / +5~+10% / ≥+10% |
| `historical_limit_up_count` | `historyLimitCount` | -1 | True | 6 | 0 次 / 1 次 / 2 次 / 3~5 次 / 6~10 次 / >10 次 |

> `orientation = +1` ⇒ 契约认为「桶越大分越高」；`-1` ⇒ 「桶越小分越高」。
> 单因子排名用**原始值**，故 `-1` 的先验含义是「原始值越大越差」。

## 三、样本账（12 个 Run 逐项核对）

| 因子 | 候选 | 公共底座入池 | 可排名样本 | 因子缺失被剔 | 剔除合计 | 账平 | 未扫描 | 重复 eventId |
|---|---|---|---|---|---|---|---|---|
| `bodyHeight` | 73003 | 70236 | 70236 | 0 | 2767 | ✅ | 0 | 0 |
| `turnover` | 73003 | 70236 | 70236 | 0 | 2767 | ✅ | 0 | 0 |
| `amountPercentile` | 73003 | 70236 | 70236 | 0 | 2767 | ✅ | 0 | 0 |
| `meanAmplitude` | 73003 | 70236 | 70236 | 0 | 2767 | ✅ | 0 | 0 |
| `maxAmplitude` | 73003 | 70236 | 70236 | 0 | 2767 | ✅ | 0 | 0 |
| `holdStreak` | 73003 | 70236 | 70236 | 0 | 2767 | ✅ | 0 | 0 |
| `t1VolumeRatio` | 73003 | 70236 | 70236 | 0 | 2767 | ✅ | 0 | 0 |
| `limitGap` | 73003 | 70236 | 67746 | 2490 | 5257 | ✅ | 0 | 0 |
| `preReturn10` | 73003 | 70236 | 70236 | 0 | 2767 | ✅ | 0 | 0 |
| `drawdownDepth` | 73003 | 70236 | 70236 | 0 | 2767 | ✅ | 0 | 0 |
| `t1OpenGap` | 73003 | 70236 | 70236 | 0 | 2767 | ✅ | 0 | 0 |
| `historyLimitCount` | 73003 | 70236 | 70236 | 0 | 2767 | ✅ | 0 | 0 |

守恒式（两级，逐 Run 核对）：

- `候选 − 可排名 = 剔除合计 = Σ 剔除原因`（全链）；
- `剔除合计 = (候选 − 入池) + 因子缺失被剔`；
- `入池 − 因子缺失被剔 = 可排名`。

**全部 12 个 Run 的样本账均守恒 ✅。**

其中仅 `limitGap` 存在**入池后**的因子值缺失（2490 条，原因码 `FACTOR_VALUE_MISSING`）：首次涨停无前次涨停 ⇒ `limitGap` 无值，无法参与排名。
其余 11 个因子在入池后无额外剔除（可排名 = 入池）。

## 四、主判据：配对日度超额（12 因子 × 8 组合）

单元格 = `日均超额 [CI95 下, CI95 上] 判定`。判定：CI95 下界 > 0 ⇒ POSITIVE；上界 < 0 ⇒ NEGATIVE；跨 0 ⇒ INCONCLUSIVE。

### HIGH 方向

| 因子 | N3 | N5 | N10 | N20 |
|---|---|---|---|---|
| `bodyHeight` | -0.002697 [-0.005483, +0.000283] INC | -0.002640 [-0.004770, -0.000520] NEG | -0.001276 [-0.002521, -0.000051] NEG | -0.000836 [-0.001546, -0.000086] NEG |
| `turnover` | -0.005161 [-0.007977, -0.002265] NEG | -0.003662 [-0.005789, -0.001503] NEG | -0.002819 [-0.004312, -0.001481] NEG | -0.001202 [-0.002146, -0.000357] NEG |
| `amountPercentile` | +0.002224 [-0.000887, +0.005476] INC | +0.000396 [-0.002206, +0.003119] INC | -0.000303 [-0.001988, +0.001512] INC | -0.000557 [-0.001624, +0.000631] INC |
| `meanAmplitude` | -0.009856 [-0.013803, -0.006139] NEG | -0.007408 [-0.010263, -0.004712] NEG | -0.005097 [-0.006733, -0.003425] NEG | -0.002660 [-0.003778, -0.001564] NEG |
| `maxAmplitude` | -0.009960 [-0.013115, -0.006774] NEG | -0.006306 [-0.008999, -0.003680] NEG | -0.004809 [-0.006389, -0.003112] NEG | -0.002790 [-0.003841, -0.001715] NEG |
| `holdStreak` | -0.010722 [-0.014778, -0.006913] NEG | -0.007336 [-0.010040, -0.004656] NEG | -0.002882 [-0.004249, -0.001549] NEG | -0.001768 [-0.002685, -0.000923] NEG |
| `t1VolumeRatio` | +0.000888 [-0.001343, +0.002908] INC | +0.000941 [-0.000584, +0.002402] INC | +0.000910 [-0.000100, +0.001958] INC | +0.000846 [+0.000065, +0.001583] POS |
| `limitGap` | +0.001142 [-0.001085, +0.003401] INC | +0.001420 [-0.000295, +0.003305] INC | +0.001715 [+0.000323, +0.003095] POS | +0.001459 [+0.000603, +0.002333] POS |
| `preReturn10` | -0.001691 [-0.005078, +0.001561] INC | -0.000800 [-0.003660, +0.001875] INC | -0.001089 [-0.002715, +0.000519] INC | -0.000992 [-0.002133, +0.000143] INC |
| `drawdownDepth` | -0.008278 [-0.011640, -0.005232] NEG | -0.005653 [-0.007929, -0.003439] NEG | -0.002366 [-0.003592, -0.000987] NEG | -0.000953 [-0.001837, +0.000001] INC |
| `t1OpenGap` | -0.005487 [-0.007972, -0.003042] NEG | -0.003416 [-0.005120, -0.001658] NEG | -0.001592 [-0.002707, -0.000399] NEG | -0.000800 [-0.001582, -0.000033] NEG |
| `historyLimitCount` | -0.000758 [-0.003282, +0.001586] INC | -0.000299 [-0.002145, +0.001677] INC | -0.000349 [-0.001803, +0.001089] INC | -0.000342 [-0.001375, +0.000732] INC |

### LOW 方向

| 因子 | N3 | N5 | N10 | N20 |
|---|---|---|---|---|
| `bodyHeight` | +0.000298 [-0.002000, +0.002528] INC | +0.001201 [-0.000565, +0.002898] INC | +0.000321 [-0.000949, +0.001587] INC | +0.000628 [-0.000299, +0.001514] INC |
| `turnover` | -0.000691 [-0.002989, +0.001845] INC | +0.000765 [-0.001085, +0.002530] INC | +0.000624 [-0.000663, +0.001851] INC | +0.000630 [-0.000359, +0.001508] INC |
| `amountPercentile` | +0.001111 [-0.001562, +0.003495] INC | +0.000498 [-0.001523, +0.002348] INC | +0.000255 [-0.001232, +0.001725] INC | +0.000405 [-0.000731, +0.001600] INC |
| `meanAmplitude` | +0.001738 [-0.000256, +0.003885] INC | +0.001923 [+0.000178, +0.003678] POS | +0.002168 [+0.000876, +0.003517] POS | +0.002346 [+0.001435, +0.003335] POS |
| `maxAmplitude` | +0.003522 [+0.001522, +0.005532] POS | +0.002805 [+0.001094, +0.004680] POS | +0.002797 [+0.001454, +0.004168] POS | +0.002666 [+0.001721, +0.003729] POS |
| `holdStreak` | +0.000364 [-0.001724, +0.002684] INC | +0.000974 [-0.000585, +0.002457] INC | +0.001427 [+0.000300, +0.002568] POS | +0.001051 [+0.000330, +0.001824] POS |
| `t1VolumeRatio` | -0.003202 [-0.005769, -0.000393] NEG | -0.001894 [-0.003935, +0.000132] INC | -0.000781 [-0.002019, +0.000478] INC | -0.001072 [-0.001978, -0.000291] NEG |
| `limitGap` | -0.001636 [-0.004213, +0.001040] INC | -0.002112 [-0.003918, -0.000309] NEG | -0.001793 [-0.003027, -0.000539] NEG | -0.001940 [-0.002888, -0.001093] NEG |
| `preReturn10` | +0.001937 [-0.000457, +0.004352] INC | +0.000397 [-0.001489, +0.002172] INC | +0.000153 [-0.001289, +0.001444] INC | -0.000215 [-0.001175, +0.000778] INC |
| `drawdownDepth` | +0.000740 [-0.001506, +0.003307] INC | +0.001296 [-0.000465, +0.003002] INC | +0.001053 [-0.000203, +0.002244] INC | +0.000669 [-0.000300, +0.001588] INC |
| `t1OpenGap` | -0.001241 [-0.003281, +0.000969] INC | +0.000461 [-0.001134, +0.002109] INC | +0.000912 [-0.000099, +0.002014] INC | +0.000652 [-0.000039, +0.001272] INC |
| `historyLimitCount` | +0.001454 [-0.000770, +0.004033] INC | +0.000520 [-0.001427, +0.002624] INC | -0.000154 [-0.001602, +0.001419] INC | +0.000265 [-0.000774, +0.001276] INC |

## 五、日胜率（超额 > 0 的决策日占比）

| 因子 | HIGH_N3 | HIGH_N5 | HIGH_N10 | HIGH_N20 | LOW_N3 | LOW_N5 | LOW_N10 | LOW_N20 |
|---|---|---|---|---|---|---|---|---|
| `bodyHeight` | 0.4377 | 0.4516 | 0.4601 | 0.4606 | 0.4781 | 0.5008 | 0.5006 | 0.5328 |
| `turnover` | 0.4037 | 0.4310 | 0.4396 | 0.4434 | 0.4695 | 0.4959 | 0.5089 | 0.5136 |
| `amountPercentile` | 0.4760 | 0.4700 | 0.4889 | 0.4831 | 0.4663 | 0.4759 | 0.5028 | 0.5162 |
| `meanAmplitude` | 0.3869 | 0.4072 | 0.4092 | 0.4116 | 0.4960 | 0.5262 | 0.5421 | 0.5738 |
| `maxAmplitude` | 0.3778 | 0.4110 | 0.4214 | 0.4229 | 0.5273 | 0.5462 | 0.5637 | 0.5857 |
| `holdStreak` | 0.3940 | 0.4056 | 0.4441 | 0.4613 | 0.4641 | 0.4819 | 0.5133 | 0.5162 |
| `t1VolumeRatio` | 0.4717 | 0.4819 | 0.5011 | 0.5255 | 0.4382 | 0.4586 | 0.4673 | 0.4666 |
| `limitGap` | 0.4886 | 0.4992 | 0.5112 | 0.5430 | 0.4389 | 0.4415 | 0.4551 | 0.4365 |
| `preReturn10` | 0.4414 | 0.4586 | 0.4662 | 0.4626 | 0.4846 | 0.4938 | 0.4900 | 0.4983 |
| `drawdownDepth` | 0.4096 | 0.4148 | 0.4474 | 0.4567 | 0.4803 | 0.4900 | 0.5216 | 0.5314 |
| `t1OpenGap` | 0.4145 | 0.4343 | 0.4618 | 0.4705 | 0.4593 | 0.4846 | 0.5172 | 0.5109 |
| `historyLimitCount` | 0.4366 | 0.4678 | 0.4751 | 0.4831 | 0.4668 | 0.4846 | 0.4884 | 0.5096 |

## 六、TopN 变化（同一方向沿 N3 → N20 的走势）

| 因子 | HIGH 日均超额（N3/N5/N10/N20） | HIGH 走势 | HIGH 判定序列 | LOW 日均超额（N3/N5/N10/N20） | LOW 走势 | LOW 判定序列 |
|---|---|---|---|---|---|---|
| `bodyHeight` | -0.002697 / -0.002640 / -0.001276 / -0.000836 | 严格单调升 | INC / NEG / NEG / NEG | +0.000298 / +0.001201 / +0.000321 / +0.000628 | 非单调（2 升 / 1 降） | INC / INC / INC / INC |
| `turnover` | -0.005161 / -0.003662 / -0.002819 / -0.001202 | 严格单调升 | NEG / NEG / NEG / NEG | -0.000691 / +0.000765 / +0.000624 / +0.000630 | 非单调（2 升 / 1 降） | INC / INC / INC / INC |
| `amountPercentile` | +0.002224 / +0.000396 / -0.000303 / -0.000557 | 严格单调降 | INC / INC / INC / INC | +0.001111 / +0.000498 / +0.000255 / +0.000405 | 非单调（1 升 / 2 降） | INC / INC / INC / INC |
| `meanAmplitude` | -0.009856 / -0.007408 / -0.005097 / -0.002660 | 严格单调升 | NEG / NEG / NEG / NEG | +0.001738 / +0.001923 / +0.002168 / +0.002346 | 严格单调升 | INC / POS / POS / POS |
| `maxAmplitude` | -0.009960 / -0.006306 / -0.004809 / -0.002790 | 严格单调升 | NEG / NEG / NEG / NEG | +0.003522 / +0.002805 / +0.002797 / +0.002666 | 严格单调降 | POS / POS / POS / POS |
| `holdStreak` | -0.010722 / -0.007336 / -0.002882 / -0.001768 | 严格单调升 | NEG / NEG / NEG / NEG | +0.000364 / +0.000974 / +0.001427 / +0.001051 | 非单调（2 升 / 1 降） | INC / INC / POS / POS |
| `t1VolumeRatio` | +0.000888 / +0.000941 / +0.000910 / +0.000846 | 非单调（1 升 / 2 降） | INC / INC / INC / POS | -0.003202 / -0.001894 / -0.000781 / -0.001072 | 非单调（2 升 / 1 降） | NEG / INC / INC / NEG |
| `limitGap` | +0.001142 / +0.001420 / +0.001715 / +0.001459 | 非单调（2 升 / 1 降） | INC / INC / POS / POS | -0.001636 / -0.002112 / -0.001793 / -0.001940 | 非单调（1 升 / 2 降） | INC / NEG / NEG / NEG |
| `preReturn10` | -0.001691 / -0.000800 / -0.001089 / -0.000992 | 非单调（2 升 / 1 降） | INC / INC / INC / INC | +0.001937 / +0.000397 / +0.000153 / -0.000215 | 严格单调降 | INC / INC / INC / INC |
| `drawdownDepth` | -0.008278 / -0.005653 / -0.002366 / -0.000953 | 严格单调升 | NEG / NEG / NEG / INC | +0.000740 / +0.001296 / +0.001053 / +0.000669 | 非单调（1 升 / 2 降） | INC / INC / INC / INC |
| `t1OpenGap` | -0.005487 / -0.003416 / -0.001592 / -0.000800 | 严格单调升 | NEG / NEG / NEG / NEG | -0.001241 / +0.000461 / +0.000912 / +0.000652 | 非单调（2 升 / 1 降） | INC / INC / INC / INC |
| `historyLimitCount` | -0.000758 / -0.000299 / -0.000349 / -0.000342 | 非单调（2 升 / 1 降） | INC / INC / INC / INC | +0.001454 / +0.000520 / -0.000154 / +0.000265 | 非单调（1 升 / 2 降） | INC / INC / INC / INC |

> 「走势」只看 4 个档位的**符号与次序**，不构成对档位的择优；8 个组合全部输出，不做事后挑选。

## 七、方向性证据（要求 7 之一：单因子自身是否存在方向性证据）

判据（**先验、非事后**）：冻结契约的 `orientation = +1` 表示「原始值越大越好」，
`-1` 表示「原始值越大越差」。⇒ 期望 `HIGH_Nk − LOW_Nk` 的符号 = `orientation`。逐档看符号是否一致。

| 因子 | orientation | 期望符号 | N3 差 | N5 差 | N10 差 | N20 差 | 符号一致档数 | CI 分离情况 |
|---|---|---|---|---|---|---|---|---|
| `bodyHeight` | -1 | − | -0.002995 | -0.003841 | -0.001597 | -0.001464 | 4/4 | N3:重叠 N5:重叠 N10:重叠 N20:重叠 |
| `turnover` | -1 | − | -0.004470 | -0.004427 | -0.003442 | -0.001832 | 4/4 | N3:重叠 N5:分离(L>H) N10:分离(L>H) N20:重叠 |
| `amountPercentile` | -1 | − | +0.001113 | -0.000102 | -0.000558 | -0.000962 | 3/4 | N3:重叠 N5:重叠 N10:重叠 N20:重叠 |
| `meanAmplitude` | -1 | − | -0.011594 | -0.009331 | -0.007265 | -0.005007 | 4/4 | N3:分离(L>H) N5:分离(L>H) N10:分离(L>H) N20:分离(L>H) |
| `maxAmplitude` | -1 | − | -0.013482 | -0.009111 | -0.007606 | -0.005456 | 4/4 | N3:分离(L>H) N5:分离(L>H) N10:分离(L>H) N20:分离(L>H) |
| `holdStreak` | +1 | + | -0.011086 | -0.008311 | -0.004309 | -0.002819 | 0/4 | N3:分离(L>H) N5:分离(L>H) N10:分离(L>H) N20:分离(L>H) |
| `t1VolumeRatio` | +1 | + | +0.004091 | +0.002834 | +0.001690 | +0.001918 | 4/4 | N3:重叠 N5:重叠 N10:重叠 N20:分离(H>L) |
| `limitGap` | +1 | + | +0.002778 | +0.003533 | +0.003508 | +0.003399 | 4/4 | N3:重叠 N5:分离(H>L) N10:分离(H>L) N20:分离(H>L) |
| `preReturn10` | -1 | − | -0.003629 | -0.001197 | -0.001242 | -0.000777 | 4/4 | N3:重叠 N5:重叠 N10:重叠 N20:重叠 |
| `drawdownDepth` | -1 | − | -0.009018 | -0.006949 | -0.003420 | -0.001621 | 4/4 | N3:分离(L>H) N5:分离(L>H) N10:分离(L>H) N20:重叠 |
| `t1OpenGap` | +1 | + | -0.004245 | -0.003876 | -0.002504 | -0.001453 | 0/4 | N3:重叠 N5:分离(L>H) N10:分离(L>H) N20:重叠 |
| `historyLimitCount` | -1 | − | -0.002212 | -0.000819 | -0.000195 | -0.000607 | 4/4 | N3:重叠 N5:重叠 N10:重叠 N20:重叠 |

> 「CI 分离」= 同 N 下 HIGH 的 CI95 与 LOW 的 CI95 互不重叠（保守线索，**不是**正式的双臂差值检验 ——
> 本模板未输出 HIGH−LOW 差值的置信区间）。

## 八、跨年份稳定性（要求 7 之三）

每年切片重算同一套指标与判据（不是把全期结果相加）。下表按「因子 × 组合」汇总各年判定。

| 因子 | 组合 | 有交易日年数 | POS 年 | NEG 年 | INC 年 | INS 年 | 主导 | 主导占比 | 年份判定 |
|---|---|---|---|---|---|---|---|---|---|
| `bodyHeight` | HIGH_N3 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `bodyHeight` | HIGH_N5 | 8 | 0 | 1 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:NEG 2024:INC 2025:INC 2026:INC |
| `bodyHeight` | HIGH_N10 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `bodyHeight` | HIGH_N20 | 8 | 0 | 2 | 6 | 0 | INC | 0.75 | 2019:NEG 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:NEG |
| `bodyHeight` | LOW_N3 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `bodyHeight` | LOW_N5 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `bodyHeight` | LOW_N10 | 8 | 1 | 0 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:POS 2024:INC 2025:INC 2026:INC |
| `bodyHeight` | LOW_N20 | 8 | 1 | 0 | 7 | 0 | INC | 0.88 | 2019:POS 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `turnover` | HIGH_N3 | 8 | 0 | 1 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:INC 2026:INC |
| `turnover` | HIGH_N5 | 8 | 0 | 1 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:INC 2026:INC |
| `turnover` | HIGH_N10 | 8 | 0 | 1 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:INC 2026:INC |
| `turnover` | HIGH_N20 | 8 | 0 | 1 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:INC 2026:INC |
| `turnover` | LOW_N3 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `turnover` | LOW_N5 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `turnover` | LOW_N10 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `turnover` | LOW_N20 | 8 | 2 | 0 | 6 | 0 | INC | 0.75 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:POS 2024:INC 2025:POS 2026:INC |
| `amountPercentile` | HIGH_N3 | 8 | 1 | 1 | 6 | 0 | INC | 0.75 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:POS 2026:INC |
| `amountPercentile` | HIGH_N5 | 8 | 0 | 1 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:INC 2026:INC |
| `amountPercentile` | HIGH_N10 | 8 | 0 | 1 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:INC 2026:INC |
| `amountPercentile` | HIGH_N20 | 8 | 1 | 1 | 6 | 0 | INC | 0.75 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:POS 2026:INC |
| `amountPercentile` | LOW_N3 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `amountPercentile` | LOW_N5 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `amountPercentile` | LOW_N10 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `amountPercentile` | LOW_N20 | 8 | 1 | 0 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:POS 2023:INC 2024:INC 2025:INC 2026:INC |
| `meanAmplitude` | HIGH_N3 | 8 | 0 | 5 | 3 | 0 | NEG | 0.62 | 2019:NEG 2020:NEG 2021:INC 2022:NEG 2023:NEG 2024:INC 2025:NEG 2026:INC |
| `meanAmplitude` | HIGH_N5 | 8 | 0 | 4 | 4 | 0 | NEG | 0.50 | 2019:NEG 2020:NEG 2021:INC 2022:NEG 2023:INC 2024:INC 2025:NEG 2026:INC |
| `meanAmplitude` | HIGH_N10 | 8 | 0 | 4 | 4 | 0 | NEG | 0.50 | 2019:NEG 2020:NEG 2021:INC 2022:NEG 2023:INC 2024:INC 2025:NEG 2026:INC |
| `meanAmplitude` | HIGH_N20 | 8 | 0 | 2 | 6 | 0 | INC | 0.75 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:NEG 2026:INC |
| `meanAmplitude` | LOW_N3 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `meanAmplitude` | LOW_N5 | 8 | 1 | 0 | 7 | 0 | INC | 0.88 | 2019:POS 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `meanAmplitude` | LOW_N10 | 8 | 1 | 0 | 7 | 0 | INC | 0.88 | 2019:POS 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `meanAmplitude` | LOW_N20 | 8 | 4 | 0 | 4 | 0 | POS | 0.50 | 2019:POS 2020:INC 2021:INC 2022:POS 2023:POS 2024:INC 2025:POS 2026:INC |
| `maxAmplitude` | HIGH_N3 | 8 | 0 | 5 | 3 | 0 | NEG | 0.62 | 2019:NEG 2020:NEG 2021:INC 2022:NEG 2023:NEG 2024:INC 2025:NEG 2026:INC |
| `maxAmplitude` | HIGH_N5 | 8 | 0 | 4 | 4 | 0 | NEG | 0.50 | 2019:NEG 2020:NEG 2021:INC 2022:NEG 2023:INC 2024:INC 2025:NEG 2026:INC |
| `maxAmplitude` | HIGH_N10 | 8 | 0 | 5 | 3 | 0 | NEG | 0.62 | 2019:NEG 2020:NEG 2021:INC 2022:NEG 2023:INC 2024:INC 2025:NEG 2026:NEG |
| `maxAmplitude` | HIGH_N20 | 8 | 0 | 5 | 3 | 0 | NEG | 0.62 | 2019:NEG 2020:NEG 2021:INC 2022:NEG 2023:INC 2024:NEG 2025:NEG 2026:INC |
| `maxAmplitude` | LOW_N3 | 8 | 3 | 0 | 5 | 0 | INC | 0.62 | 2019:POS 2020:POS 2021:INC 2022:INC 2023:INC 2024:INC 2025:POS 2026:INC |
| `maxAmplitude` | LOW_N5 | 8 | 1 | 0 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:POS 2026:INC |
| `maxAmplitude` | LOW_N10 | 8 | 3 | 0 | 5 | 0 | INC | 0.62 | 2019:POS 2020:INC 2021:INC 2022:POS 2023:INC 2024:INC 2025:POS 2026:INC |
| `maxAmplitude` | LOW_N20 | 8 | 5 | 0 | 3 | 0 | POS | 0.62 | 2019:POS 2020:POS 2021:INC 2022:POS 2023:POS 2024:INC 2025:POS 2026:INC |
| `holdStreak` | HIGH_N3 | 8 | 0 | 4 | 4 | 0 | NEG | 0.50 | 2019:NEG 2020:INC 2021:INC 2022:NEG 2023:INC 2024:NEG 2025:NEG 2026:INC |
| `holdStreak` | HIGH_N5 | 8 | 0 | 4 | 4 | 0 | NEG | 0.50 | 2019:NEG 2020:NEG 2021:INC 2022:NEG 2023:INC 2024:INC 2025:NEG 2026:INC |
| `holdStreak` | HIGH_N10 | 8 | 0 | 3 | 5 | 0 | INC | 0.62 | 2019:INC 2020:NEG 2021:INC 2022:NEG 2023:INC 2024:INC 2025:NEG 2026:INC |
| `holdStreak` | HIGH_N20 | 8 | 0 | 3 | 5 | 0 | INC | 0.62 | 2019:INC 2020:NEG 2021:INC 2022:NEG 2023:INC 2024:INC 2025:NEG 2026:INC |
| `holdStreak` | LOW_N3 | 8 | 1 | 1 | 6 | 0 | INC | 0.75 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:POS 2024:INC 2025:NEG 2026:INC |
| `holdStreak` | LOW_N5 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `holdStreak` | LOW_N10 | 8 | 2 | 0 | 6 | 0 | INC | 0.75 | 2019:POS 2020:INC 2021:INC 2022:INC 2023:POS 2024:INC 2025:INC 2026:INC |
| `holdStreak` | LOW_N20 | 8 | 2 | 0 | 6 | 0 | INC | 0.75 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:POS 2024:POS 2025:INC 2026:INC |
| `t1VolumeRatio` | HIGH_N3 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `t1VolumeRatio` | HIGH_N5 | 8 | 2 | 0 | 6 | 0 | INC | 0.75 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:POS 2026:POS |
| `t1VolumeRatio` | HIGH_N10 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `t1VolumeRatio` | HIGH_N20 | 8 | 2 | 0 | 6 | 0 | INC | 0.75 | 2019:INC 2020:INC 2021:INC 2022:POS 2023:POS 2024:INC 2025:INC 2026:INC |
| `t1VolumeRatio` | LOW_N3 | 8 | 0 | 1 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:INC 2026:INC |
| `t1VolumeRatio` | LOW_N5 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `t1VolumeRatio` | LOW_N10 | 8 | 0 | 1 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:INC 2026:INC |
| `t1VolumeRatio` | LOW_N20 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `limitGap` | HIGH_N3 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `limitGap` | HIGH_N5 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `limitGap` | HIGH_N10 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `limitGap` | HIGH_N20 | 8 | 2 | 0 | 5 | 1 | INC | 0.71 | 2019:INS 2020:INC 2021:INC 2022:INC 2023:POS 2024:INC 2025:POS 2026:INC |
| `limitGap` | LOW_N3 | 8 | 0 | 1 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:INC 2026:INC |
| `limitGap` | LOW_N5 | 8 | 0 | 1 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:INC 2026:INC |
| `limitGap` | LOW_N10 | 8 | 0 | 2 | 6 | 0 | INC | 0.75 | 2019:NEG 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:INC 2026:INC |
| `limitGap` | LOW_N20 | 8 | 0 | 3 | 4 | 1 | INC | 0.57 | 2019:INS 2020:INC 2021:INC 2022:NEG 2023:NEG 2024:NEG 2025:INC 2026:INC |
| `preReturn10` | HIGH_N3 | 8 | 0 | 1 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:INC 2026:INC |
| `preReturn10` | HIGH_N5 | 8 | 0 | 1 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:INC 2025:INC 2026:INC |
| `preReturn10` | HIGH_N10 | 8 | 0 | 2 | 6 | 0 | INC | 0.75 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:NEG 2024:INC 2025:INC 2026:INC |
| `preReturn10` | HIGH_N20 | 8 | 0 | 3 | 5 | 0 | INC | 0.62 | 2019:INC 2020:NEG 2021:INC 2022:NEG 2023:NEG 2024:INC 2025:INC 2026:INC |
| `preReturn10` | LOW_N3 | 8 | 2 | 0 | 6 | 0 | INC | 0.75 | 2019:POS 2020:INC 2021:INC 2022:INC 2023:POS 2024:INC 2025:INC 2026:INC |
| `preReturn10` | LOW_N5 | 8 | 1 | 0 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:POS 2024:INC 2025:INC 2026:INC |
| `preReturn10` | LOW_N10 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `preReturn10` | LOW_N20 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `drawdownDepth` | HIGH_N3 | 8 | 0 | 4 | 4 | 0 | NEG | 0.50 | 2019:NEG 2020:INC 2021:INC 2022:NEG 2023:INC 2024:NEG 2025:NEG 2026:INC |
| `drawdownDepth` | HIGH_N5 | 8 | 0 | 3 | 5 | 0 | INC | 0.62 | 2019:INC 2020:INC 2021:INC 2022:NEG 2023:INC 2024:NEG 2025:NEG 2026:INC |
| `drawdownDepth` | HIGH_N10 | 8 | 0 | 2 | 6 | 0 | INC | 0.75 | 2019:INC 2020:INC 2021:NEG 2022:INC 2023:INC 2024:INC 2025:NEG 2026:INC |
| `drawdownDepth` | HIGH_N20 | 8 | 0 | 3 | 5 | 0 | INC | 0.62 | 2019:NEG 2020:INC 2021:INC 2022:INC 2023:NEG 2024:INC 2025:NEG 2026:INC |
| `drawdownDepth` | LOW_N3 | 8 | 1 | 1 | 6 | 0 | INC | 0.75 | 2019:POS 2020:NEG 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `drawdownDepth` | LOW_N5 | 8 | 2 | 0 | 6 | 0 | INC | 0.75 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:POS 2025:POS 2026:INC |
| `drawdownDepth` | LOW_N10 | 8 | 1 | 0 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:POS 2026:INC |
| `drawdownDepth` | LOW_N20 | 8 | 2 | 2 | 4 | 0 | INC | 0.50 | 2019:INC 2020:NEG 2021:INC 2022:INC 2023:INC 2024:POS 2025:POS 2026:NEG |
| `t1OpenGap` | HIGH_N3 | 8 | 0 | 3 | 5 | 0 | INC | 0.62 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:NEG 2024:NEG 2025:NEG 2026:INC |
| `t1OpenGap` | HIGH_N5 | 8 | 0 | 3 | 5 | 0 | INC | 0.62 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:NEG 2024:NEG 2025:NEG 2026:INC |
| `t1OpenGap` | HIGH_N10 | 8 | 0 | 1 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:NEG 2026:INC |
| `t1OpenGap` | HIGH_N20 | 8 | 0 | 1 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:NEG 2026:INC |
| `t1OpenGap` | LOW_N3 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `t1OpenGap` | LOW_N5 | 8 | 1 | 0 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:POS 2026:INC |
| `t1OpenGap` | LOW_N10 | 8 | 2 | 0 | 6 | 0 | INC | 0.75 | 2019:POS 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:POS 2026:INC |
| `t1OpenGap` | LOW_N20 | 8 | 1 | 0 | 7 | 0 | INC | 0.88 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:POS 2026:INC |
| `historyLimitCount` | HIGH_N3 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `historyLimitCount` | HIGH_N5 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `historyLimitCount` | HIGH_N10 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `historyLimitCount` | HIGH_N20 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `historyLimitCount` | LOW_N3 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `historyLimitCount` | LOW_N5 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `historyLimitCount` | LOW_N10 | 8 | 0 | 0 | 8 | 0 | INC | 1.00 | 2019:INC 2020:INC 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |
| `historyLimitCount` | LOW_N20 | 8 | 1 | 0 | 7 | 0 | INC | 0.88 | 2019:INC 2020:POS 2021:INC 2022:INC 2023:INC 2024:INC 2025:INC 2026:INC |

## 九、三类问题的分别回答（要求 7）

本节三个结论**全部由下表规则从信封机械推出**，不做事后挑选。

**规则**

- **(a) 单因子自身是否存在方向性证据**：看 §七 的「符号一致档数」与 CI 分离。
  `4/4 且至少一档 CI 按期望方向分离` ⇒ **强**；`4/4 但无分离` ⇒ **中**；`< 4/4` ⇒ **弱/反向**。
  （`orientation = +1` ⇒ 期望 HIGH 优于 LOW；`-1` ⇒ 期望 LOW 优于 HIGH。）
- **(b) 是否只是某个 TopN 档表现较好**：看 8 个组合的判定分布。
  `8 档全 INCONCLUSIVE` ⇒ **无档位效应**；`显著格恰 1 个` ⇒ **疑似仅单档**；`≥2 个` ⇒ **判定分叉**。
- **(c) 是否存在跨年份稳定性**：只在**全期为显著判定**的组合上评（对每个这样的组合，
  数「年份判定与全期判定同号」的年数 ÷ 「年份判定为显著」的年数，8 个组合汇总）。
  `同号占比 ≥ 0.8` ⇒ **稳定**；`0.5 ~ 0.8` ⇒ **部分**；`< 0.5` ⇒ **不稳定**。

| 因子 | (a) 方向性证据 | (b) TopN 档位效应 | (c) 跨年份稳定性 |
|---|---|---|---|
| `bodyHeight` | 中（4/4 符号一致，无 CI 分离） | 判定分叉（3 格显著：HIGH_N5, HIGH_N10, HIGH_N20） | **稳定**（3/3，覆盖 3 个显著组合） |
| `turnover` | **强**（4/4 + CI 分离） | 判定分叉（4 格显著：HIGH_N3, HIGH_N5, HIGH_N10, HIGH_N20） | **稳定**（4/4，覆盖 4 个显著组合） |
| `amountPercentile` | 弱/反向（3/4） | 无档位效应（8 档全 INCONCLUSIVE） | 无显著组合可评 |
| `meanAmplitude` | **强**（4/4 + CI 分离） | 判定分叉（7 格显著：HIGH_N3, HIGH_N5, HIGH_N10, HIGH_N20, LOW_N5, LOW_N10, LOW_N20） | **稳定**（21/21，覆盖 7 个显著组合） |
| `maxAmplitude` | **强**（4/4 + CI 分离） | 判定分叉（8 格显著：HIGH_N3, HIGH_N5, HIGH_N10, HIGH_N20, LOW_N3, LOW_N5, LOW_N10, LOW_N20） | **稳定**（31/31，覆盖 8 个显著组合） |
| `holdStreak` | 弱/反向（0/4） | 判定分叉（6 格显著：HIGH_N3, HIGH_N5, HIGH_N10, HIGH_N20, LOW_N10, LOW_N20） | **稳定**（18/18，覆盖 6 个显著组合） |
| `t1VolumeRatio` | **强**（4/4 + CI 分离） | 判定分叉（3 格显著：HIGH_N20, LOW_N3, LOW_N20） | **稳定**（3/3，覆盖 3 个显著组合） |
| `limitGap` | **强**（4/4 + CI 分离） | 判定分叉（5 格显著：HIGH_N10, HIGH_N20, LOW_N5, LOW_N10, LOW_N20） | **稳定**（8/8，覆盖 5 个显著组合） |
| `preReturn10` | 中（4/4 符号一致，无 CI 分离） | 无档位效应（8 档全 INCONCLUSIVE） | 无显著组合可评 |
| `drawdownDepth` | **强**（4/4 + CI 分离） | 判定分叉（3 格显著：HIGH_N3, HIGH_N5, HIGH_N10） | **稳定**（9/9，覆盖 3 个显著组合） |
| `t1OpenGap` | 弱/反向（0/4） | 判定分叉（4 格显著：HIGH_N3, HIGH_N5, HIGH_N10, HIGH_N20） | **稳定**（8/8，覆盖 4 个显著组合） |
| `historyLimitCount` | 中（4/4 符号一致，无 CI 分离） | 无档位效应（8 档全 INCONCLUSIVE） | 无显著组合可评 |

> ⚠️ (b) 的「显著格」是**观测到的判定**，不是「挑出来的最好档位」：8 个组合在任何 Run 里都全部输出，
> 本文只是把已经落在信封里的判定按档位列出来读。

## 十、判定统计与多重比较

| 判定 | 组合级（12×8=96） | 年切片级 | 合计 |
|---|---|---|---|
| POSITIVE | 12 | 50 | 62 |
| NEGATIVE | 31 | 99 | 130 |
| INCONCLUSIVE | 53 | 617 | 670 |
| INSUFFICIENT | 0 | 2 | 2 |
| **合计** | **96** | **768** | **864** |

⚠️ α=0.05 下，864 个判定行的假阳性期望 ≈ **43.2** 个。
年切片与 8 个档位彼此高度重叠（同一批事件、同一持有期），**不构成独立证据**。

## 十一、限制与窗口限定

- 数据集 `v5` 覆盖 2019-01-01 ~ 2026-09-04（决策日与持有期跨越牛熊与注册制前后，口径未分层）。
- 池子口径 = 12F 入池池（要求 12 因子全齐），因此「每日可排名样本量」同时受 12 因子齐全约束。
- `totalReturn` 是**持有期重叠**的日度组合收益连乘结果，**不是资金曲线**（基准同构造，故差值仍有效）。
- 全部结论为**探索性**（`researchPhase = EXPLORATORY`），不得当作策略结论或用于选股。

### 逐因子披露原文（`customPayload.disclosures`，各 Run 12 条，任取第一个 Run 核对）

1. 🔴 观察窗不是买入窗：T+1~T+5 只用于取信息（因子 / 排名 / 信号的信息截止日 = T+5 收盘）；唯一入场点是 T+6 开盘。把这段窗口读成「可以反复买入」是对口径的误解。
2. 🔴 池子口径：候选池 = 12F 的入池池（要求 12 个因子全部可评估），因此 bodyHeight 之外因子的缺失也会减少样本；这样 12 个单因子实验跑在同一份样本上，「哪个因子更能挑」才成立。
3. 🔴 基准不是指数：基准 = 当日全部可排名候选的等权。随机抽 N 只的期望恒等于该值 ⇒ 「正超额」= 「平均意义上优于随机抽签」，而不是跑赢大盘。
4. 🔴 持仓重叠：持有期 T+6 开盘 → T+10 收盘（5 个交易日）⇒ 相邻决策日的持仓互相重叠，日度序列不是独立观测；CI 用 block=20 的日期聚类 Moving-Block Bootstrap 吸收这一点，但不得把 N 个决策日当 N 个独立实验。
5. 🔴 8 个组合全部输出（2 方向 × 4 档），**没有**任何「只保留最优组合」的开关 ⇒ 结构上禁止事后择优；但 8 个组合仍是 8 次比较，α=0.05 下假阳性期望 ≈ 0.4，结论只能声明为**探索性**。
6. ⚠️ 因子定义 / 桶边界 / 方向零改动：全部来自 FROZEN-BUCKET-CONTRACT-001（唯一落地处为 twelve-factor-composite-study/result.ts）；本模板**不使用桶位分排序**（用因子原始值），桶词表只作留档。
7. ⚠️ 成本口径：netReturn = grossReturn − 20bps（比例直接相减），与公共底座 derive.ts 逐字一致 ⇒ 与 12F / Top-N 的净收益逐位可比。
8. ⚠️ 未扫描事件数：0（0 = 全量成立，null = 总数未知）。
9. ⚠️ 本 Run 是 EXPLORATORY：没有 OOS / Holdout，不构成「策略可用」的证据。
10. ⚠️ 年切片各自做 Bootstrap 判定 ⇒ 又一批多重比较，只用于描述「是否只在某几年有效」。
11. ⚠️ 排序并列时按 eventId 升序打破（确定性）⇒ 同一份数据重复运行结果完全一致。
12. ⚠️ Bootstrap 种子公式：组合级 = BASE + 1000 + comboIndex×100000；组合×年 = 组合级 + (year−2000)。因此「不同组合 / 不同年份的 CI 不同」是种子设计使然，**不能**据此推断样本不同。

## 附录 A：冻结坐标（12 个 Run 逐位一致）

- 坐标取值集合大小 = **1**（应为 1，表示 12 个 Run 坐标完全相同）
- 坐标 = `{"entryRelativeDay": 6, "eventRelativeDay": 0, "exitRelativeDay": 10, "informationCutoffRelativeDay": 5, "maxRelativeDay": 20, "observationEnd": 5, "observationStart": 1, "roundTripCostBps": 20}`

- 模板代码摘要（`experimentCodeDigest`）唯一值数 = **1**（应为 1 ⇒ 12 个 Run 跑的是**完全同一份**模板代码）
  - `exp-code-sha256:3883166e85c0dfb19db4326903028c3e43017f7d396e7ce832835b348cb4be48`
- `experimentId` 唯一值数 = **1**；`experimentVersion` 唯一值数 = **1**。
- 不同 `parameters` 的个数 = **12**（应为 12：每个 Run 一个 `factorCode`）。
- 数据集绑定唯一值数 = **1**：`first_limit_pullback` **v5**（`datasetVersionId = 660001`）

## 附录 B：复现

**启动参数**（12 个 Run 除 `factorCode` 外完全相同）：

| 项 | 值 |
|---|---|
| `experimentId` | `first-board-pullback/single-factor-v1` |
| `experimentVersion` | `1.0.0` |
| `parameters` | `{ "factorCode": <因子 code> }`（唯一变量） |
| 数据集绑定 | `first_limit_pullback` **v5**（`datasetVersionId = 660001`） |
| `researchPhase` | `EXPLORATORY` |

**执行约束**（本轮实测，下次复跑必须遵守）：

1. 并发上限 **4 路**。**12 路并行会 OOM**：实测跑到 12.5 分钟时 `FATAL ERROR: NewSpace::EnsureCurrentCapacity Allocation failed — JavaScript heap out of memory`，12 个进程全部崩溃、结果全丢；4 路分 3 批则连续 8 个 Run 全部成功。
2. 产物落盘**必须在工作区内**。写工作区外（如 `C:/work/...`）会被沙箱拒绝（`EPERM: operation not permitted`）。
3. 跨境 TiDB 会瞬断：未被重试包裹的裸查询（如 `dataset_definition` / `research_experiment_run` 状态回读）一撞就直接抛出；建议重试 ≥ 4 次、退避 60s。

本轮使用的一次性 harness（`scripts/_tmp_sf12_run.mts`）已删除；12 个真实信封保留在 `.workbuddy/_scratch/sf12/`（`.workbuddy/` 不在 git 索引，不污染仓库），可直接重新解析。

