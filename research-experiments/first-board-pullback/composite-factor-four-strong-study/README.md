# 组合因子等权 · 强正向四因子子集（`first-board-pullback/composite-factor-four-strong-study`）

> **口径文档，不是结论文档。** 本文件只说明**这个实验的样本、坐标与判定口径**；
> 结论一律以真实 Run 的信封 + `docs/research/` 下的结果报告为准。

## 1. 一句话定义

把 `composite-factor-equal-weight-study`（12 因子等权）的成员换成**对齐臂已判 `POSITIVE` 的 4 个冻结因子**，
其余一切（标准化 / 权重 / 档位 / 日集 / 坐标 / 统计 / Bootstrap / 样本池）**逐字不动**，
用来检验「12 因子等权是否被稀释」这个假说。

## 2. 唯一差异：`members`

| 项 | 12 因子实例 | 本实例 |
|---|---|---|
| `members` | `FROZEN_TWELVE_FACTOR_MEMBERS`（12 个） | `STRONG_SUBSET_CODES`（4 个，见下） |
| `normalization` | `BUCKET_POSITIONAL` | 同 |
| `weighting` | `{ mode: "EQUAL" }` | 同（各 **1/4**，不做权重优化） |
| `topNSizes` | `3 / 5 / 10 / 20` | 同（静态枚举，全输出） |
| `dayScopes` | `OWN` / `FIXED` | 同 |
| 坐标 | 入场 `T+6` 开盘 / 退出 `T+10` 收盘 / 往返 `20 bps` | 同（`assertTemplateCoordinate()` 每次 Run 断言） |
| 样本池 | `deriveTwelveFactorSamples`（12 因子完备用例） | 同**同一份**（⇒ 逐条相同） |

保留的 4 个成员（方向由契约 `orientation` 推出，**不在组合里重估**）：

| `code` | 标签 | `orientation` | 合成内方向 | 方向置信 |
|---|---|---|---|---|
| `maxAmplitude` | T+1..T+5 最大振幅 | -1 | `LOW` | 已验证 |
| `meanAmplitude` | T+1..T+5 平均振幅 | -1 | `LOW` | 已验证 |
| `t1VolumeRatio` | T+1 成交量 ÷ T 日成交量 | +1 | `HIGH` | 已验证 |
| `limitGap` | 前次涨停间隔 | +1 | `HIGH` | **先验未验证** |

> ⚠️ 成员是**事后按已读数据挑的**（依据 = `RESULT-12F-TOPN-002.md` §6.2 / §6.4 的对齐臂判定）
> ⇒ 本实验属 `EXPLORATORY`，**不是 OOS**，不构成策略证据。

## 3. 主判据

**配对日度超额** = 当日 TopN 等权净收益 − 当日全部可排名候选等权净收益（同日、同成本、同坐标）。

- 随机抽 N 只的**期望恒等于当日池均值** ⇒ 「正超额」= 平均意义上**优于随机抽签**，不是跑赢指数；
- 三态判定：CI 下界 > 0 ⇒ `POSITIVE`；上界 < 0 ⇒ `NEGATIVE`；跨 0 ⇒ `INCONCLUSIVE`；决策日 < 100 ⇒ `INSUFFICIENT`；
- 置信区间 = **日期聚类 Moving-Block Bootstrap**（block = 20 交易日；持仓 T+6→T+10 重叠）。

## 4. 与 12 因子实例的可比性

- 样本池同一份 ⇒ **候选 / 入池 / 剔除原因 / 可评估数逐项相同**（实测 73003 → 70236 → 70236）；
- 各档 `OWN` 日集由「当日可用样本 ≥ N」决定、与本组合的成员无关 ⇒ **日集逐档相同**；
- ⇒ 两实例的 `N3 / N5 / N10 / N20` 可以**逐档直接比较**（差异只可能来自排序键）。

## 5. 复现

页面：研究实验 → 「组合因子等权（强正向四因子）」→ 选 Dataset `v5`（`660001`）→ 运行。

```bash
node node_modules/tsx/dist/cli.mjs scripts/testChanged.mts --seed client/src/researchExperiments/pages.ts
```

## 6. 刻意不做

- ❌ 不等权 / 权重搜索（`CUSTOM` 接口虽已预留，本实例不启用）；
- ❌ 不新增因子、不改因子定义 / 桶边界 / 方向；
- ❌ 不做归因、不做 OOS、不宣称最优区间。
