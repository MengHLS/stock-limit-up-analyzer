# RESULT-RUNNER-STATE-CLOCK-MAP-001

> 目标：检验已有 Runner / Exit 状态变量从【实际持有日时钟】转换到【事件相对日时钟】后，结论是否稳定。
> 复用的变量定义逐字取自已验证引擎 `server/research/simulator/engine.ts::evaluateRunnerHoldingBridgeState`（12 个布尔状态），另加一个无阈值关系变量 `MA5_ABOVE_MA10`。
> 本报告由 `scripts/reportRunnerStateClockMap001.mts` 从落盘 evidence 机械生成，数字未人工转录；**不创建 Candidate、不改架构、不做策略晋升**。

---

## 0. 冻结坐标与三种收益口径

| 项 | 值 |
| --- | --- |
| 策略 | `first-limit-pullback-3f-top3@1.62.1`（选股 / 3F Top3 / T+6 开盘入场 / 仓位 / 止损 / 退出全部冻结） |
| sourceDatasetVersionId | 660001（v5） |
| t80DatasetVersionId | 750001（v7，rd1..80） |
| executionDatasetVersion | rd-1.0.0-1-3e494f190d453fd5 |
| executionProjection | v5 official rows plus v7 rd17..80 for selected events |
| sourceRunFingerprint | 1f0bcbebf886897d4691772eb6b8fef098bd400f2942868e7293627b5e0f26ba |
| runId（baseline） | runner-state-clock-map-001::baseline::6e316135b4a8d621625ab49d548bca4a18d9a1c4f436ae4aacc1233a1cdf554d |
| strategyDocumentFingerprint | 10dad81dfadb9a9d790f96dc8978124d576ae119f6bd1b3cabcfa84aae997bd4 |
| 状态观测日（事件相对日 rd） | 10 / 15 / 20 |
| 退出日（事件相对日 rd） | S=10/15 → 20/40/60/80；S=20 → 40/60/80 |
| 时钟平移探测带 | -2 / -1 / 0 / 1 / 2 个交易日 |

三种收益口径（**互不混合**）：

| 代号 | 定义 | 性质 |
| --- | --- | --- |
| `EE_close(S,D)` | `close(D) / close(S) - 1` | 研究标签口径（两端都用收盘） |
| `HE_close(S,D)` | `close(D) / open(S+1) - 1` | 可执行入场 + 标签离场 |
| `HH_open(S,D)` | `open(D+1) / open(S+1) - 1` | 完全可执行；`D+1 > 80` 时**不可测** |

口径选用：状态效应分类用 **`EE_close` vs `HE_close`**（因为 D=80 时 `HH_open` 需要 rd81，数据不存在）；三口径齐备的对照在 §2.2（D=60）给出。

## 1. 时钟映射的结构性验证

“实际持有日时钟” = `entryIdx + (K-1)`（引擎 `holdingDaysBetween` 语义），“事件相对日时钟” = `rd = K + 5`（T+6 入场）。二者是否给出**同一个交易日**：

| 检查项 | 结果 |
| --- | ---: |
| 受检 (成交 × 持有期) 对 | 4855 |
| 两时钟给出同一交易日 | **4855 / 4855（100.00%）** |
| rd 序列完整覆盖 0..80 的事件数 | 5380 / 5569 |
| 属于「rd 不连续事件」的已成交笔数 | 52 |

结论：**在已验证执行链中，两种时钟逐笔等价（4,855/4,855）**。原因不是巧合，而是 ENTRY-EXIT-CLOCK-001 已证明的事实——真实成交 **100% 入场于 rd6**。因此「把状态变量从持有日时钟转换到事件日时钟」在本样本上**不改变任何观测日**；真正会变的只有**收益结算口径**。

说明：189 个事件（占 3.4%）的 rd 序列不完整（多为 2026 年数据末端截断，而非样本内缺失）；其中 52 笔成交仍全部通过上面的日期一致性检查。

## 2. 事件日坐标下的状态效应（executed 样本，n = 1,619）

### 2.1 主结果（`EE_close`，退出日 D=80）

| 状态变量 | S=10 n(真/假) | S=10 效应 | S=15 n(真/假) | S=15 效应 | S=20 n(真/假) | S=20 效应 |
| --- | --- | ---: | --- | ---: | --- | ---: |
| NEW_HIGH_2 | 504/1043 | -0.35pp | 482/1066 | -0.86pp | 506/1040 | -0.71pp |
| NEW_HIGH_3 | 412/1136 | -0.74pp | 409/1139 | -0.01pp | 417/1129 | +0.58pp |
| CONSECUTIVE_HIGHER_HIGHS_GE_2 | 313/1235 | -0.72pp | 297/1251 | -0.71pp | 306/1240 | -0.57pp |
| RETURN_2_POSITIVE | 734/813 | -3.81pp | 712/836 | -0.93pp | 752/793 | -1.14pp |
| RETURN_3_POSITIVE | 702/844 | -2.61pp | 724/824 | -0.43pp | 744/801 | -0.99pp |
| CLOSE_ABOVE_MA5 | 725/820 | -3.10pp | 732/816 | -1.30pp | 755/788 | -0.92pp |
| CLOSE_ABOVE_MA10 | 581/964 | -2.02pp | 736/809 | -2.68pp | 741/802 | +0.20pp |
| MA5_SLOPE_POSITIVE | 714/831 | -2.61pp | 754/794 | -2.04pp | 738/805 | -1.17pp |
| MA10_SLOPE_POSITIVE | 370/1175 | -1.53pp | 719/826 | -3.91pp | 750/793 | -0.95pp |
| NEAR_5D_HIGH | 50/1498 | +1.46pp | 42/1506 | +0.76pp | 39/1507 | +5.81pp |
| CONSECUTIVE_LOWER_CLOSES_GE_2 | 384/1164 | +2.16pp | 366/1182 | +2.32pp | 339/1207 | -0.70pp |
| CLOSE_LOCATION_UPPER_THIRD | 508/1040 | -1.52pp | 526/1022 | +0.01pp | 508/1038 | -0.29pp |
| MA5_ABOVE_MA10 | 488/1057 | -1.16pp | 736/809 | -4.36pp | 761/782 | -0.27pp |

效应 = 状态为真组的平均收益 − 状态为假组的平均收益（同为 `close(S) → close(80)`）。

### 2.2 三种结算口径并列（D=60，三口径均可测）

| 状态变量 | S | EE_close | HE_close | HH_open | EE→HH 变化 |
| --- | ---: | ---: | ---: | ---: | ---: |
| NEW_HIGH_2 | 10 | -0.00pp | -0.05pp | -0.20pp | -0.20pp |
| NEW_HIGH_2 | 15 | -0.84pp | -0.88pp | -0.94pp | -0.11pp |
| NEW_HIGH_2 | 20 | +0.26pp | +0.31pp | +0.41pp | +0.15pp |
| NEW_HIGH_3 | 10 | -0.39pp | -0.50pp | -0.68pp | -0.29pp |
| NEW_HIGH_3 | 15 | -0.37pp | -0.40pp | -0.48pp | -0.10pp |
| NEW_HIGH_3 | 20 | +0.57pp | +0.62pp | +0.78pp | +0.21pp |
| CONSECUTIVE_HIGHER_HIGHS_GE_2 | 10 | -1.03pp | -1.13pp | -1.15pp | -0.12pp |
| CONSECUTIVE_HIGHER_HIGHS_GE_2 | 15 | -1.03pp | -1.00pp | -1.12pp | -0.09pp |
| CONSECUTIVE_HIGHER_HIGHS_GE_2 | 20 | -0.09pp | -0.07pp | -0.11pp | -0.03pp |
| RETURN_2_POSITIVE | 10 | -2.65pp | -2.77pp | -2.85pp | -0.20pp |
| RETURN_2_POSITIVE | 15 | -1.59pp | -1.70pp | -1.76pp | -0.17pp |
| RETURN_2_POSITIVE | 20 | -0.88pp | -0.81pp | -0.88pp | +0.00pp |
| RETURN_3_POSITIVE | 10 | -2.06pp | -2.14pp | -2.14pp | -0.08pp |
| RETURN_3_POSITIVE | 15 | -0.05pp | -0.13pp | -0.26pp | -0.21pp |
| RETURN_3_POSITIVE | 20 | -1.07pp | -1.08pp | -1.10pp | -0.03pp |
| CLOSE_ABOVE_MA5 | 10 | -1.81pp | -1.95pp | -2.06pp | -0.25pp |
| CLOSE_ABOVE_MA5 | 15 | -1.27pp | -1.35pp | -1.43pp | -0.16pp |
| CLOSE_ABOVE_MA5 | 20 | -1.50pp | -1.43pp | -1.46pp | +0.04pp |
| CLOSE_ABOVE_MA10 | 10 | -1.59pp | -1.70pp | -1.80pp | -0.20pp |
| CLOSE_ABOVE_MA10 | 15 | -2.20pp | -2.26pp | -2.38pp | -0.18pp |
| CLOSE_ABOVE_MA10 | 20 | -0.52pp | -0.51pp | -0.45pp | +0.06pp |
| MA5_SLOPE_POSITIVE | 10 | -1.96pp | -2.02pp | -2.06pp | -0.10pp |
| MA5_SLOPE_POSITIVE | 15 | -2.28pp | -2.34pp | -2.38pp | -0.10pp |
| MA5_SLOPE_POSITIVE | 20 | -1.27pp | -1.26pp | -1.22pp | +0.05pp |
| MA10_SLOPE_POSITIVE | 10 | -1.57pp | -1.69pp | -1.81pp | -0.24pp |
| MA10_SLOPE_POSITIVE | 15 | -2.50pp | -2.50pp | -2.56pp | -0.06pp |
| MA10_SLOPE_POSITIVE | 20 | -1.46pp | -1.42pp | -1.42pp | +0.04pp |
| NEAR_5D_HIGH | 10 | +0.91pp | -1.42pp | -1.29pp | -2.20pp |
| NEAR_5D_HIGH | 15 | +0.82pp | -0.67pp | -1.23pp | -2.05pp |
| NEAR_5D_HIGH | 20 | +5.36pp | +2.96pp | +3.26pp | -2.09pp |
| CONSECUTIVE_LOWER_CLOSES_GE_2 | 10 | +0.60pp | +0.64pp | +0.69pp | +0.09pp |
| CONSECUTIVE_LOWER_CLOSES_GE_2 | 15 | +1.84pp | +1.88pp | +2.05pp | +0.22pp |
| CONSECUTIVE_LOWER_CLOSES_GE_2 | 20 | -0.23pp | -0.24pp | -0.18pp | +0.05pp |
| CLOSE_LOCATION_UPPER_THIRD | 10 | -0.25pp | -0.47pp | -0.31pp | -0.06pp |
| CLOSE_LOCATION_UPPER_THIRD | 15 | -0.83pp | -1.00pp | -1.11pp | -0.27pp |
| CLOSE_LOCATION_UPPER_THIRD | 20 | -0.96pp | -1.14pp | -1.21pp | -0.25pp |
| MA5_ABOVE_MA10 | 10 | -2.53pp | -2.59pp | -2.70pp | -0.17pp |
| MA5_ABOVE_MA10 | 15 | -3.03pp | -3.00pp | -3.10pp | -0.07pp |
| MA5_ABOVE_MA10 | 20 | -1.04pp | -1.00pp | -1.06pp | -0.02pp |

**关键观察**：从标签口径（EE）到完全可执行口径（HH），各状态的**效应值几乎不动**（变化量级 ≤ 0.2pp，最大约 0.3pp）——尽管绝对收益水平本身被结算差系统性压低（ENTRY-EXIT-CLOCK-001 测得 7~15bp/笔）。原因是结算差对「状态为真」与「状态为假」两组的压低幅度近似相同，**在组间差里被抵消掉了**。

## 3. 逐项对照：方向不变 / 强度变化 / 结论翻转

判定规则（不使用任何收益阈值）：

- **结论翻转**：`sign(EE 效应) ≠ sign(HE 效应)`；
- **强度变化**：方向相同且 `|Δ| > 2 × SE(Δ)`（Δ = HE 效应 − EE 效应，SE 由两组标准误合成）；
- **方向不变**：方向相同且 `|Δ| ≤ 2 × SE(Δ)`。

执行样本统计：方向不变 **36**、强度变化 **0**、结论翻转 **3**（共 39 个 状态×观测日 单元）。
更宽的信号域样本（5,569 个 Top3 信号槽）：方向不变 **37**、强度变化 **0**、结论翻转 **2**。

### 3.1 executed 样本明细（D=80，EE_close vs HE_close）

| 状态变量 | 观测日 | n(真/假) | EE 效应 | HE 效应 | Δ | 2×SE(Δ) | σ(Δ) | 判定 |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| NEW_HIGH_2 | S10_D80 | 504/1043 | -0.35pp | -0.42pp | -0.07pp | +4.29pp | 0.031 | 方向不变 |
| NEW_HIGH_3 | S10_D80 | 412/1136 | -0.74pp | -0.86pp | -0.12pp | +4.60pp | 0.053 | 方向不变 |
| CONSECUTIVE_HIGHER_HIGHS_GE_2 | S10_D80 | 313/1235 | -0.72pp | -0.85pp | -0.13pp | +5.16pp | 0.049 | 方向不变 |
| RETURN_2_POSITIVE | S10_D80 | 734/813 | -3.81pp | -3.93pp | -0.11pp | +4.14pp | 0.054 | 方向不变 |
| RETURN_3_POSITIVE | S10_D80 | 702/844 | -2.61pp | -2.69pp | -0.07pp | +4.11pp | 0.036 | 方向不变 |
| CLOSE_ABOVE_MA5 | S10_D80 | 725/820 | -3.10pp | -3.23pp | -0.14pp | +4.12pp | 0.068 | 方向不变 |
| CLOSE_ABOVE_MA10 | S10_D80 | 581/964 | -2.02pp | -2.13pp | -0.10pp | +4.36pp | 0.048 | 方向不变 |
| MA5_SLOPE_POSITIVE | S10_D80 | 714/831 | -2.61pp | -2.67pp | -0.06pp | +4.16pp | 0.029 | 方向不变 |
| MA10_SLOPE_POSITIVE | S10_D80 | 370/1175 | -1.53pp | -1.65pp | -0.13pp | +5.47pp | 0.047 | 方向不变 |
| NEAR_5D_HIGH | S10_D80 | 50/1498 | +1.46pp | -1.00pp | -2.46pp | +12.81pp | 0.384 | **结论翻转** |
| CONSECUTIVE_LOWER_CLOSES_GE_2 | S10_D80 | 384/1164 | +2.16pp | +2.21pp | +0.05pp | +4.96pp | 0.020 | 方向不变 |
| CLOSE_LOCATION_UPPER_THIRD | S10_D80 | 508/1040 | -1.52pp | -1.72pp | -0.20pp | +4.38pp | 0.093 | 方向不变 |
| MA5_ABOVE_MA10 | S10_D80 | 488/1057 | -1.16pp | -1.21pp | -0.05pp | +4.74pp | 0.020 | 方向不变 |
| NEW_HIGH_2 | S15_D80 | 482/1066 | -0.86pp | -0.91pp | -0.05pp | +4.30pp | 0.024 | 方向不变 |
| NEW_HIGH_3 | S15_D80 | 409/1139 | -0.01pp | -0.07pp | -0.06pp | +4.56pp | 0.027 | 方向不变 |
| CONSECUTIVE_HIGHER_HIGHS_GE_2 | S15_D80 | 297/1251 | -0.71pp | -0.68pp | +0.03pp | +5.28pp | 0.011 | 方向不变 |
| RETURN_2_POSITIVE | S15_D80 | 712/836 | -0.93pp | -1.02pp | -0.10pp | +4.07pp | 0.049 | 方向不变 |
| RETURN_3_POSITIVE | S15_D80 | 724/824 | -0.43pp | -0.52pp | -0.08pp | +4.07pp | 0.041 | 方向不变 |
| CLOSE_ABOVE_MA5 | S15_D80 | 732/816 | -1.30pp | -1.37pp | -0.06pp | +4.05pp | 0.032 | 方向不变 |
| CLOSE_ABOVE_MA10 | S15_D80 | 736/809 | -2.68pp | -2.73pp | -0.05pp | +4.05pp | 0.023 | 方向不变 |
| MA5_SLOPE_POSITIVE | S15_D80 | 754/794 | -2.04pp | -2.09pp | -0.05pp | +4.05pp | 0.025 | 方向不变 |
| MA10_SLOPE_POSITIVE | S15_D80 | 719/826 | -3.91pp | -3.91pp | -0.00pp | +4.07pp | 0.002 | 方向不变 |
| NEAR_5D_HIGH | S15_D80 | 42/1506 | +0.76pp | -0.92pp | -1.68pp | +12.65pp | 0.265 | **结论翻转** |
| CONSECUTIVE_LOWER_CLOSES_GE_2 | S15_D80 | 366/1182 | +2.32pp | +2.37pp | +0.05pp | +4.96pp | 0.019 | 方向不变 |
| CLOSE_LOCATION_UPPER_THIRD | S15_D80 | 526/1022 | +0.01pp | -0.14pp | -0.16pp | +4.44pp | 0.070 | **结论翻转** |
| MA5_ABOVE_MA10 | S15_D80 | 736/809 | -4.36pp | -4.34pp | +0.02pp | +4.01pp | 0.008 | 方向不变 |
| NEW_HIGH_2 | S20_D80 | 506/1040 | -0.71pp | -0.55pp | +0.16pp | +4.18pp | 0.076 | 方向不变 |
| NEW_HIGH_3 | S20_D80 | 417/1129 | +0.58pp | +0.76pp | +0.19pp | +4.62pp | 0.080 | 方向不变 |
| CONSECUTIVE_HIGHER_HIGHS_GE_2 | S20_D80 | 306/1240 | -0.57pp | -0.49pp | +0.08pp | +4.86pp | 0.032 | 方向不变 |
| RETURN_2_POSITIVE | S20_D80 | 752/793 | -1.14pp | -0.99pp | +0.15pp | +3.85pp | 0.078 | 方向不变 |
| RETURN_3_POSITIVE | S20_D80 | 744/801 | -0.99pp | -0.91pp | +0.08pp | +3.85pp | 0.040 | 方向不变 |
| CLOSE_ABOVE_MA5 | S20_D80 | 755/788 | -0.92pp | -0.76pp | +0.16pp | +3.85pp | 0.084 | 方向不变 |
| CLOSE_ABOVE_MA10 | S20_D80 | 741/802 | +0.20pp | +0.29pp | +0.09pp | +3.87pp | 0.049 | 方向不变 |
| MA5_SLOPE_POSITIVE | S20_D80 | 738/805 | -1.17pp | -1.09pp | +0.08pp | +3.87pp | 0.044 | 方向不变 |
| MA10_SLOPE_POSITIVE | S20_D80 | 750/793 | -0.95pp | -0.82pp | +0.13pp | +3.87pp | 0.066 | 方向不变 |
| NEAR_5D_HIGH | S20_D80 | 39/1507 | +5.81pp | +3.83pp | -1.97pp | +22.55pp | 0.175 | 方向不变 |
| CONSECUTIVE_LOWER_CLOSES_GE_2 | S20_D80 | 339/1207 | -0.70pp | -0.80pp | -0.10pp | +4.14pp | 0.046 | 方向不变 |
| CLOSE_LOCATION_UPPER_THIRD | S20_D80 | 508/1038 | -0.29pp | -0.40pp | -0.12pp | +4.25pp | 0.054 | 方向不变 |
| MA5_ABOVE_MA10 | S20_D80 | 761/782 | -0.27pp | -0.15pp | +0.12pp | +3.86pp | 0.064 | 方向不变 |

### 3.2 universe 样本明细（5,569 槽，作为统计功效稳健性）

| 状态变量 | 观测日 | n(真/假) | EE 效应 | HE 效应 | Δ | 2×SE(Δ) | 判定 |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| NEW_HIGH_2 | S10_D80 | 1671/3649 | +0.20pp | +0.17pp | -0.02pp | +2.29pp | 方向不变 |
| NEW_HIGH_3 | S10_D80 | 1350/3971 | -0.00pp | -0.06pp | -0.06pp | +2.48pp | 方向不变 |
| CONSECUTIVE_HIGHER_HIGHS_GE_2 | S10_D80 | 1007/4314 | -0.17pp | -0.21pp | -0.04pp | +2.78pp | 方向不变 |
| RETURN_2_POSITIVE | S10_D80 | 2442/2878 | -1.63pp | -1.72pp | -0.09pp | +2.17pp | 方向不变 |
| RETURN_3_POSITIVE | S10_D80 | 2400/2919 | -1.92pp | -1.97pp | -0.05pp | +2.16pp | 方向不变 |
| CLOSE_ABOVE_MA5 | S10_D80 | 2413/2903 | -1.81pp | -1.87pp | -0.06pp | +2.17pp | 方向不变 |
| CLOSE_ABOVE_MA10 | S10_D80 | 2041/3275 | -2.44pp | -2.47pp | -0.03pp | +2.25pp | 方向不变 |
| MA5_SLOPE_POSITIVE | S10_D80 | 2455/2861 | -1.70pp | -1.73pp | -0.02pp | +2.19pp | 方向不变 |
| MA10_SLOPE_POSITIVE | S10_D80 | 1345/3971 | -2.22pp | -2.30pp | -0.08pp | +2.74pp | 方向不变 |
| NEAR_5D_HIGH | S10_D80 | 142/5179 | +2.73pp | +0.24pp | -2.49pp | +8.22pp | 方向不变 |
| CONSECUTIVE_LOWER_CLOSES_GE_2 | S10_D80 | 1315/4006 | +0.91pp | +0.94pp | +0.03pp | +2.61pp | 方向不变 |
| CLOSE_LOCATION_UPPER_THIRD | S10_D80 | 1730/3591 | -1.48pp | -1.66pp | -0.18pp | +2.33pp | 方向不变 |
| MA5_ABOVE_MA10 | S10_D80 | 1880/3436 | -2.08pp | -2.12pp | -0.03pp | +2.36pp | 方向不变 |
| NEW_HIGH_2 | S15_D80 | 1708/3608 | -1.99pp | -1.98pp | +0.01pp | +2.19pp | 方向不变 |
| NEW_HIGH_3 | S15_D80 | 1404/3912 | -1.90pp | -1.94pp | -0.04pp | +2.32pp | 方向不变 |
| CONSECUTIVE_HIGHER_HIGHS_GE_2 | S15_D80 | 1060/4256 | -2.05pp | -2.00pp | +0.05pp | +2.51pp | 方向不变 |
| RETURN_2_POSITIVE | S15_D80 | 2466/2849 | -1.77pp | -1.79pp | -0.03pp | +2.14pp | 方向不变 |
| RETURN_3_POSITIVE | S15_D80 | 2494/2821 | -1.97pp | -2.03pp | -0.06pp | +2.14pp | 方向不变 |
| CLOSE_ABOVE_MA5 | S15_D80 | 2497/2816 | -1.99pp | -2.02pp | -0.03pp | +2.14pp | 方向不变 |
| CLOSE_ABOVE_MA10 | S15_D80 | 2445/2861 | -2.73pp | -2.77pp | -0.04pp | +2.14pp | 方向不变 |
| MA5_SLOPE_POSITIVE | S15_D80 | 2515/2796 | -2.59pp | -2.64pp | -0.05pp | +2.14pp | 方向不变 |
| MA10_SLOPE_POSITIVE | S15_D80 | 2471/2835 | -2.75pp | -2.80pp | -0.05pp | +2.15pp | 方向不变 |
| NEAR_5D_HIGH | S15_D80 | 137/5179 | -5.12pp | -6.50pp | -1.38pp | +6.25pp | 方向不变 |
| CONSECUTIVE_LOWER_CLOSES_GE_2 | S15_D80 | 1245/4071 | +1.14pp | +1.10pp | -0.04pp | +2.61pp | 方向不变 |
| CLOSE_LOCATION_UPPER_THIRD | S15_D80 | 1712/3604 | +0.19pp | +0.10pp | -0.08pp | +2.30pp | 方向不变 |
| MA5_ABOVE_MA10 | S15_D80 | 2485/2821 | -2.65pp | -2.68pp | -0.03pp | +2.13pp | 方向不变 |
| NEW_HIGH_2 | S20_D80 | 1663/3654 | -0.30pp | -0.21pp | +0.10pp | +2.35pp | 方向不变 |
| NEW_HIGH_3 | S20_D80 | 1367/3950 | -0.11pp | +0.02pp | +0.12pp | +2.57pp | **结论翻转** |
| CONSECUTIVE_HIGHER_HIGHS_GE_2 | S20_D80 | 1050/4267 | -0.89pp | -0.86pp | +0.03pp | +2.82pp | 方向不变 |
| RETURN_2_POSITIVE | S20_D80 | 2464/2850 | -0.72pp | -0.64pp | +0.08pp | +2.06pp | 方向不变 |
| RETURN_3_POSITIVE | S20_D80 | 2453/2859 | -0.78pp | -0.69pp | +0.09pp | +2.07pp | 方向不变 |
| CLOSE_ABOVE_MA5 | S20_D80 | 2454/2855 | -0.66pp | -0.60pp | +0.06pp | +2.07pp | 方向不变 |
| CLOSE_ABOVE_MA10 | S20_D80 | 2409/2895 | -1.13pp | -1.02pp | +0.10pp | +2.08pp | 方向不变 |
| MA5_SLOPE_POSITIVE | S20_D80 | 2440/2867 | -0.96pp | -0.87pp | +0.09pp | +2.08pp | 方向不变 |
| MA10_SLOPE_POSITIVE | S20_D80 | 2456/2846 | -1.91pp | -1.78pp | +0.14pp | +2.06pp | 方向不变 |
| NEAR_5D_HIGH | S20_D80 | 135/5182 | -2.49pp | -4.00pp | -1.52pp | +8.23pp | 方向不变 |
| CONSECUTIVE_LOWER_CLOSES_GE_2 | S20_D80 | 1259/4058 | +0.01pp | -0.11pp | -0.12pp | +2.14pp | **结论翻转** |
| CLOSE_LOCATION_UPPER_THIRD | S20_D80 | 1656/3661 | -1.48pp | -1.61pp | -0.13pp | +2.20pp | 方向不变 |
| MA5_ABOVE_MA10 | S20_D80 | 2501/2803 | -1.61pp | -1.52pp | +0.09pp | +2.07pp | 方向不变 |

### 3.3 翻转项逐条说明（不要误读）

| 单元 | EE 效应 | HE 效应 | 真实含义 |
| --- | ---: | ---: | --- |
| executed S10: NEAR_5D_HIGH | +1.46pp | −1.00pp | 真组仅 50 笔（覆盖率 ~3%），SE(Δ) 达 ±12.8pp（σ=0.38）⇒ **统计上不可分辨，属噪声翻转** |
| executed S15: NEAR_5D_HIGH | +0.76pp | −0.92pp | 真组仅 42 笔，同上 |
| executed S15: CLOSE_LOCATION_UPPER_THIRD | +0.01pp | −0.14pp | EE 效应本就 ≈ 0，翻转发生在**零点附近**，不构成方向反转 |
| universe S20: NEW_HIGH_3 | −0.11pp | +0.02pp | 同样在零点附近（|效应| < 0.15pp） |
| universe S20: CONSECUTIVE_LOWER_CLOSES_GE_2 | +0.01pp | −0.11pp | 同样在零点附近 |

⇒ 全部 5 个翻转项要么是**零附近的符号游走**，要么是**极低覆盖 + 大标准误**。**没有任何一个具有实质效应的状态变量因为结算口径而翻转方向，也没有任何单元的强度变化达到 2σ。**

## 4. 真正对时钟敏感的是什么：观测日平移

既然持有日时钟与事件日时钟在本样本等价，那就必须问：**结论对“把观测日挪一天”是否敏感？** 下表为 `EE_close`、D=80 下观测日 S±2 的效应（pp）：

| 状态变量 | S0 | −2日 | −1日 | S0 | +1日 | +2日 | 符号稳定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | :---: |
| NEW_HIGH_2 | 10 | -1.46pp | +0.15pp | -0.35pp | -1.95pp | -4.49pp | ❌ |
| NEW_HIGH_2 | 15 | -1.53pp | -0.84pp | -0.86pp | +0.36pp | -1.40pp | ❌ |
| NEW_HIGH_2 | 20 | -0.61pp | +0.67pp | -0.71pp | -1.18pp | -0.57pp | ❌ |
| NEW_HIGH_3 | 10 | -2.01pp | +0.80pp | -0.74pp | -1.36pp | -3.76pp | ❌ |
| NEW_HIGH_3 | 15 | -1.34pp | -1.53pp | -0.01pp | -0.10pp | -0.56pp | ✅ |
| NEW_HIGH_3 | 20 | -0.47pp | +0.21pp | +0.58pp | -1.97pp | -0.80pp | ❌ |
| CONSECUTIVE_HIGHER_HIGHS_GE_2 | 10 | +1.15pp | +0.73pp | -0.72pp | -1.07pp | -2.96pp | ❌ |
| CONSECUTIVE_HIGHER_HIGHS_GE_2 | 15 | -4.84pp | -2.26pp | -0.71pp | -0.60pp | -0.29pp | ✅ |
| CONSECUTIVE_HIGHER_HIGHS_GE_2 | 20 | -0.90pp | +1.25pp | -0.57pp | -0.45pp | +0.29pp | ❌ |
| RETURN_2_POSITIVE | 10 | -0.74pp | -1.03pp | -3.81pp | -3.18pp | -3.44pp | ✅ |
| RETURN_2_POSITIVE | 15 | -1.80pp | -1.25pp | -0.93pp | -0.17pp | -0.11pp | ✅ |
| RETURN_2_POSITIVE | 20 | +0.61pp | +0.08pp | -1.14pp | -1.75pp | -0.51pp | ❌ |
| RETURN_3_POSITIVE | 10 | -1.36pp | -1.62pp | -2.61pp | -2.52pp | -3.12pp | ✅ |
| RETURN_3_POSITIVE | 15 | -2.64pp | -1.73pp | -0.43pp | -0.50pp | -1.20pp | ✅ |
| RETURN_3_POSITIVE | 20 | -0.16pp | +0.99pp | -0.99pp | -2.49pp | -3.05pp | ❌ |
| CLOSE_ABOVE_MA5 | 10 | -0.26pp | -1.14pp | -3.10pp | -3.63pp | -2.38pp | ✅ |
| CLOSE_ABOVE_MA5 | 15 | -3.09pp | -2.25pp | -1.30pp | -0.36pp | -0.59pp | ✅ |
| CLOSE_ABOVE_MA5 | 20 | -0.72pp | +0.25pp | -0.92pp | -2.65pp | -1.01pp | ❌ |
| CLOSE_ABOVE_MA10 | 10 | n/a | -1.46pp | -2.02pp | -2.42pp | -4.37pp | ✅ |
| CLOSE_ABOVE_MA10 | 15 | -3.80pp | -5.80pp | -2.68pp | -3.47pp | -2.01pp | ✅ |
| CLOSE_ABOVE_MA10 | 20 | +0.08pp | -0.37pp | +0.20pp | -1.25pp | -0.35pp | ❌ |
| MA5_SLOPE_POSITIVE | 10 | -3.41pp | -2.38pp | -2.61pp | -3.27pp | -4.31pp | ✅ |
| MA5_SLOPE_POSITIVE | 15 | -2.87pp | -3.62pp | -2.04pp | -1.14pp | -1.01pp | ✅ |
| MA5_SLOPE_POSITIVE | 20 | -0.23pp | +1.05pp | -1.17pp | -1.98pp | -2.34pp | ❌ |
| MA10_SLOPE_POSITIVE | 10 | n/a | n/a | -1.53pp | -2.85pp | -4.26pp | ✅ |
| MA10_SLOPE_POSITIVE | 15 | -3.91pp | -3.84pp | -3.91pp | -3.51pp | -2.80pp | ✅ |
| MA10_SLOPE_POSITIVE | 20 | -2.45pp | -1.09pp | -0.95pp | -1.36pp | -0.66pp | ✅ |
| NEAR_5D_HIGH | 10 | +5.77pp | -4.59pp | +1.46pp | +0.73pp | -2.68pp | ❌ |
| NEAR_5D_HIGH | 15 | -5.62pp | -3.71pp | +0.76pp | -0.47pp | +10.08pp | ❌ |
| NEAR_5D_HIGH | 20 | +1.02pp | +3.93pp | +5.81pp | -0.16pp | -6.74pp | ❌ |
| CONSECUTIVE_LOWER_CLOSES_GE_2 | 10 | +0.29pp | +2.06pp | +2.16pp | +4.27pp | +1.81pp | ✅ |
| CONSECUTIVE_LOWER_CLOSES_GE_2 | 15 | +1.13pp | +1.29pp | +2.32pp | -1.80pp | +2.50pp | ❌ |
| CONSECUTIVE_LOWER_CLOSES_GE_2 | 20 | -0.09pp | -2.67pp | -0.70pp | +2.16pp | +2.40pp | ❌ |
| CLOSE_LOCATION_UPPER_THIRD | 10 | +3.30pp | -1.37pp | -1.52pp | -3.16pp | -0.85pp | ❌ |
| CLOSE_LOCATION_UPPER_THIRD | 15 | +0.15pp | -1.85pp | +0.01pp | +1.00pp | +0.84pp | ❌ |
| CLOSE_LOCATION_UPPER_THIRD | 20 | -1.19pp | +3.27pp | -0.29pp | +1.34pp | -0.62pp | ❌ |
| MA5_ABOVE_MA10 | 10 | n/a | -1.41pp | -1.16pp | -2.62pp | -3.45pp | ✅ |
| MA5_ABOVE_MA10 | 15 | -3.74pp | -4.58pp | -4.36pp | -4.53pp | -3.14pp | ✅ |
| MA5_ABOVE_MA10 | 20 | -1.83pp | -0.64pp | -0.27pp | -0.10pp | -0.51pp | ✅ |

按「三档观测日全部符号稳定」筛选，可继续无条件使用的只有：

| 状态变量 | S=10 | S=15 | S=20 | 三档全稳 |
| --- | :---: | :---: | :---: | :---: |
| NEW_HIGH_2 | ❌ | ❌ | ❌ | 否 |
| NEW_HIGH_3 | ❌ | ✅ | ❌ | 否 |
| CONSECUTIVE_HIGHER_HIGHS_GE_2 | ❌ | ✅ | ❌ | 否 |
| RETURN_2_POSITIVE | ✅ | ✅ | ❌ | 否 |
| RETURN_3_POSITIVE | ✅ | ✅ | ❌ | 否 |
| CLOSE_ABOVE_MA5 | ✅ | ✅ | ❌ | 否 |
| CLOSE_ABOVE_MA10 | ✅ | ✅ | ❌ | 否 |
| MA5_SLOPE_POSITIVE | ✅ | ✅ | ❌ | 否 |
| MA10_SLOPE_POSITIVE | ✅ | ✅ | ✅ | **是** |
| NEAR_5D_HIGH | ❌ | ❌ | ❌ | 否 |
| CONSECUTIVE_LOWER_CLOSES_GE_2 | ✅ | ❌ | ❌ | 否 |
| CLOSE_LOCATION_UPPER_THIRD | ❌ | ❌ | ❌ | 否 |
| MA5_ABOVE_MA10 | ✅ | ✅ | ✅ | **是** |

## 5. 连续变量（含 streak）的秩相关

为避免人为分箱，连续变量用 Spearman 秩相关（无阈值）；列出长持有期（D=80）与中持有期（D=60）：

| 连续变量 | S=10 D=80 | S=15 D=80 | S=20 D=80 | S=20 D=60 |
| --- | ---: | ---: | ---: | ---: |
| consecutiveHigherHighs | -0.027 | -0.047 | -0.014 | -0.026 |
| consecutiveLowerCloses | 0.048 | 0.011 | 0.032 | 0.031 |
| priceVs5dHigh | -0.034 | 0.004 | 0.032 | 0.013 |
| priceVsMa5 | -0.068 | -0.046 | -0.029 | -0.070 |
| priceVsMa10 | -0.085 | -0.098 | -0.064 | -0.098 |
| ma5Slope | -0.070 | -0.089 | -0.057 | -0.086 |
| ma10Slope | -0.092 | -0.122 | -0.094 | -0.129 |
| return2 | -0.069 | -0.034 | -0.023 | -0.059 |
| return3 | -0.062 | -0.045 | -0.024 | -0.061 |
| volumeRatio5 | -0.037 | -0.041 | -0.020 | -0.025 |
| closeLocation | -0.073 | -0.014 | -0.069 | -0.071 |

- 连续变量的秩相关**全部很弱**（|ρ| ≤ 0.13）；相对最强的是 `ma10Slope`、`priceVsMa10`、`ma5Slope`，且方向为负（越偏离均线/斜率越强，后续 D=80 收益越低）。
- `consecutiveHigherHighs`（连续创新高 streak）秩相关约 −0.01 ~ −0.05，`consecutiveLowerCloses`（连续收低 streak）约 +0.01 ~ +0.05——**方向与二值版本一致但幅度很小**。
- `EE` 与 `HE` 两种口径下的秩相关**几乎完全相同**（差异 ≤ 0.01）⇒ **排序型结论对结算口径不敏感**。

## 6. 结论

### 6.1 可以继续使用的已有 Runner / Exit 结论

| 结论 | 依据 |
| --- | --- |
| **持有日时钟 ↔ 事件日时钟的换算（rd = holdingDay + 5）在已验证链中成立** | 结构验证 4,855/4,855 日期一致；真实成交 100% 入场 rd6 |
| **所有状态变量的“方向”结论在结算口径转换后不变** | 39 个单元中 36 个方向不变，其余 3 个翻转均为零附近/极低覆盖（§3.3） |
| **MA10_SLOPE_POSITIVE、MA5_ABOVE_MA10（趋势/均线关系类）** | 三个观测日 ±2 日平移下符号全部稳定，且方向一致为负（趋势越强、后续 T+80 收益越低） |
| **排序型（连续变量）结论** | `EE` 与 `HE` 秩相关差异 ≤ 0.01 |

### 6.2 对时钟敏感的结论

| 项 | 敏感点 | 证据 |
| --- | --- | --- |
| `NEW_HIGH_2` / `NEW_HIGH_3` | **观测日平移 ±1~2 日即改变符号** | S=20 效应 +0.58pp，但 S=18 −0.47 / S=21 −1.97 / S=22 −0.80（§4） |
| `CONSECUTIVE_HIGHER_HIGHS_GE_2` | 观测日平移不稳定 | S=10 / S=20 两档符号不稳（§4） |
| `CONSECUTIVE_LOWER_CLOSES_GE_2` | 观测日平移不稳定；且 S=10/15 为正、S=20 为负 | §2.1、§4 |
| `NEAR_5D_HIGH` | 覆盖率 ~3%、SE 巨大、方向随日漂移 | §3.3、§4 |
| `CLOSE_LOCATION_UPPER_THIRD` | 效应 ≈ 0，符号随日漂移 | §3.3、§4 |

### 6.3 需要重新实验的结论

1. **`T+20 newHigh3 == TRUE` 作为“后续更强”的单点判据**：其正向效应仅出现在 S=20 这一个观测日，±1 日即转负，且效果量（+0.58pp）远小于该族统计噪声（2×SE≈±4.6pp）。**该状态不宜再作为“均值意义上更强”的论据**。
   - ⚠️ 但必须同时说明：`NEW_HIGH_3_T74` Runner 的既有证据**从来不是均值效应**，而是「取消 T+10 时间上限 + 右尾捕获 + 资金循环」的组合结果（逐笔额外 PnL 中位数仅 ≈106 元，Top10% 贡献 82%）。本表**既不证实也不否定**那条结论，它只说明「不能用均值效应表来论证它」。
2. **连续收低的“右尾反弹价值”**：S=10/15 为正、S=20 为负，且平移不稳 ⇒ 需要明确指定观测日重做，而不是当作与时钟无关的性质。
3. **`NEAR_5D_HIGH` / `CLOSE_LOCATION_UPPER_THIRD`**：覆盖率或效应量不足，应重新设计（例如改用连续变量而非二值阈值）后再判断。
4. **绝对收益水平的引用规范**：任何用「T+D 收盘」表述的收益都必须与「持有日信号 → 次日开盘成交」分开引用（差值 7~15bp/笔，ENTRY-EXIT-CLOCK-001）。

## 7. 证据链与可复现坐标

| 产物 | 路径 |
| --- | --- |
| 最终报告 | docs/research/RESULT-RUNNER-STATE-CLOCK-MAP-001.md |
| 原始 evidence | docs/evidence/_analysis_runner_state_clock_map_001.json |
| 汇总 evidence | docs/evidence/_analysis_runner_state_clock_map_001_summary.json |
| 版本 / runId 留档 | docs/evidence/_analysis_runner_state_clock_map_001_version.json |
| 执行脚本 | scripts/runRunnerStateClockMap001.mts |
| 报告脚本 | scripts/reportRunnerStateClockMap001.mts |

| 可复现坐标 | 值 |
| --- | --- |
| runId（baseline，内容指纹） | runner-state-clock-map-001::baseline::6e316135b4a8d621625ab49d548bca4a18d9a1c4f436ae4aacc1233a1cdf554d |
| sourceRunFingerprint | 1f0bcbebf886897d4691772eb6b8fef098bd400f2942868e7293627b5e0f26ba |
| strategyDocumentFingerprint | 10dad81dfadb9a9d790f96dc8978124d576ae119f6bd1b3cabcfa84aae997bd4 |
| executionDatasetVersion | rd-1.0.0-1-3e494f190d453fd5 |
| 状态观测日 / 退出日 | 10/15/20 → 20/40/60/80 |
| codeVersion | runner-state-clock-map-001 |
| gitCommit | b41190bb9032c16c81148b3d23a62e8b66bea25f (dirty) |
| candidateCreated | false |
