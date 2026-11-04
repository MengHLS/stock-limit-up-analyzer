# 十二因子等权综合评分研究（第一版）

> **实验 id**：`first-board-pullback/twelve-factor-composite-study`
> **契约**：`docs/research/FROZEN-BUCKET-CONTRACT-001.md`（**FROZEN**，桶边界 / 方向表 / 权重）
> **规格**：`docs/research/PLAN-12F-COMPOSITE-001.md`
> **结果**：`docs/research/RESULT-12F-COMPOSITE-001.md`
> **Dataset**：`first_limit_pullback` / **`v5`**（由公共底座强制）

## 这个实验做什么

把 **12 个已冻结的首板因子**各自按**桶位**映射成分数（`(idx+0.5)/k`，再按契约方向表翻转），
**等权**（各 `1/12`）求和得到 `composite ∈ (0,1)`；然后在固定坐标下看 `composite` 的十分位净收益，
并与 12 个单因子在同一份样本上的分桶结果**横向比较**。

## 坐标（口径表）

| 项 | 取值 |
|---|---|
| 事件 | `v5` 全部事件；严格收盘涨停；沪深主板；`T+1..T+5` 与 `T+6..T+10` 路径完整 |
| 决策时点 | `T+5` 收盘（用到 `T+1..T+5` 的行情） |
| **入场** | **`T+6` 开盘**（要求 `canBuyAtOpen`） |
| **退出** | **`T+10` 收盘**；不可卖 ⇒ `T+11..T+20` 内第一个可卖收盘；20 日内无 ⇒ 剔除 |
| 成本 | 往返 **20 bps** |
| 候选集 | 12 因子**完备用例**（缺任一 ⇒ 不入样本；`limitGap` 的 `UNKNOWN` 是**合法桶**，不算缺） |
| Bootstrap | 日期聚类 Moving Block，1000 次 / block 20 / 固定种子 `20260925` |
| 判定 | 样本 `< 100` ⇒ 强制「样本不足」，不给判定 |

### 12 个因子（边界与方向见契约，不在本实验内定义）

`bodyHeight` · `turnover` · `amountPercentile` · `meanAmplitude` · `maxAmplitude` ·
`holdStreak` · `t1VolumeRatio` · `limitGap` · `preReturn10` · `drawdownDepth` ·
`t1OpenGap` · `historyLimitCount`

## 输出

1. **综合评分十分位表**（`D1..D10`）+ 五分位对照；
2. **对照变体**：剔除 3 个「先验未验证方向」因子（`holdStreak` / `limitGap` / `preReturn10`）后的 9 因子子评分十分位表；
3. **12 因子冻结分桶表**（共 64 行，在同一份样本上重算）；
4. **横向比较表**（FBC-5）：12 个单因子的 `spread` + CI + 三态判定 + 原实验已冻结的定性结论，末行为综合评分自身。

## 刻意不做（禁止条款）

- ❌ **不做权重优化** —— 等权 `1/12`，本版不含任何权重搜索、因子筛选、方向再估计；
- ❌ **不重估桶边界** —— 实验内没有任何分位搜索 / 最优切点 / 聚类（FBC-2）；
- ❌ **不做归因** —— 综合评分是加权和，存在因子互相掩蔽与区间压缩；归因须走 `PLAN-FACTOR-EXP-001` 的 Phase 3（正交性）→ Phase 4（逐层叠加）；
- ❌ **不宣称最优** —— 不输出「最优因子」「最优区间」「最佳参数」；
- ❌ **不把样本内当 OOS** —— `v2~v5` 全部是已读数据；本 Run 是**探索性**；
- ❌ **不引用不同窗口的历史数字** 与单因子直接并列（单因子表在本 Run 样本上重算，窗口/入场不同则不可比）。

## 已知限制

1. 3/12 因子的方向属「**先验未验证**」（`holdStreak` / `limitGap` / `preReturn10`）⇒ 必须看 9 因子子评分对照；
2. `limitGap` 的 `UNKNOWN` 桶在契约里排最前，会被评为**最低分**；
3. 入场固定 `T+6`，与部分原实验的入场点不同 ⇒ 单因子数字与原 README 数字**必然不完全一致**（设计使然）；
4. `F3` 用「同日成交额分位」，peer 集合取当日通过过滤的事件 ⇒ 分位含义随市场结构漂移；
5. 多重比较：64 桶 + 10 档 + 12 个 spread ≈ 90 个判定，`α=0.05` 下假阳性期望 ≈ 4.5。

## 复现

```bash
# 静态检查
node node_modules/typescript/bin/tsc --noEmit --incremental false
# 运行：在「独立实验」页面选 Dataset v5 后点「运行」（或走 tRPC researchExperiments.startRun）
```

契约版本变更必须新开 `FROZEN-BUCKET-CONTRACT-002`，**不得**在本版内就地改边界或方向。
