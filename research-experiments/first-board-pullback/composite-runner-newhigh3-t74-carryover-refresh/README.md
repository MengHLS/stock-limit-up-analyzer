# composite-runner-newhigh3-t74-carryover-refresh（P7 · 跨日候选池 + 当日重评分）

**目标**：检验 P6 的 negative 是否来自“carry 没有新信息”。本实验在每个决策日对 fresh + pending 做统一重评分，而不是只给 carry 换一个分数。

## CarryRefreshV1

对当前决策日的候选，沿用 trend v2 的实测方向：

- pullbackDepth：事件以来最高收盘 → 当前收盘的回撤深度，越大越好；
- negMomentum：取负的“当前收盘 / 首板日收盘 − 1”，越大越好；
- negWindowGap：取负的“当前收盘 / 事件窗收盘均值 − 1”，越大越好。

三个分量在**当日 fresh + pending 的 union** 内分别做横截面分位，等权平均得到 refreshPercentile，再与原始 3F 分融合：

fused = (1 - w) * 3F + w * refreshPercentile

PIT：fresh 使用 T0..T+5，carry 使用 T0..当前决策日；只读到当前决策日，不使用未来数据。

## 臂

| 臂 | 选股范围 | carry | refresh 权重 |
| --- | --- | ---: | ---: |
| control | top3 | 0 | 无 |
| refresh-only-w20 | top5 | 0 | 0.20 |
| refresh-only-w35 | top5 | 0 | 0.35 |
| carry1-refresh-w20 | top5 | 1 日 | 0.20 |
| carry1-refresh-w35 | top5 | 1 日 | 0.35 |

refresh-only 用来分离“重评分本身”的影响；carry1-refresh 用来判断 carry 是否有增量。

## 冻结项

- Runner NEW_HIGH_3 / 5 / 74
- SL-18.1 退出链
- maxDailyBuys=2、maxPositions=5、成本模型
- dataset coordinates 780001 / 660001

## 判据

1. control parity 必须 PASS；
2. refresh-only 与 control 的差异，判断重评分本身是否有害/有益；
3. carry1-refresh 与同权重 refresh-only 的差异，判断 carry 增量；
4. 实现 >= +50% 笔数、C 收益、MaxDD、carry 成交净利。

## 当前状态（2026-10-05 · EXPLORATORY 真实 Run）

真实 Run：RUN-20261005-4BB55265（datasetVersionId 780001，COMPLETED，约 205 s；控制臂 parity PASS）。

| 臂 | C 收益 | C 最大回撤 | C 成交 | >=+50% | >=+100% | carry 成交 | carry 净利 | carry >=+50% |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| control | **151.10%** | 43.30% | 1434 | **9** | 2 | 0 | 0 | 0 |
| refresh-only-w20 | 25.63% | 49.11% | 1452 | 8 | 0 | 0 | 0 | 0 |
| refresh-only-w35 | −36.80% | 51.34% | 1469 | 7 | 0 | 0 | 0 | 0 |
| carry1-refresh-w20 | 82.11% | **41.14%** | 1460 | **9** | 1 | 366 | −35,695 | 1 |
| carry1-refresh-w35 | 30.69% | 52.59% | 1504 | 8 | 1 | 430 | −47,567 | 2 |

### 结论：第二轮 REJECTED

- refresh-only 已经足以说明问题：w0.20 把收益从 151.10% 降到 25.63%，w0.35 降到 −36.80%；
- carry1-refresh 没有恢复 alpha：w0.20 收益 82.11%、w0.35 收益 30.69%，均远低于控制臂；
- carry1-refresh-w20 的 >=+50% 笔数回到 9，但 C 成交增加、收益腰斩，carry 成交净利为 −35,695，不是有效增量；
- refreshUnscorableCarryCandidates=3：3 次 carry 候选当日无有效 bar（如停牌），按不可评分处理，未插补、未买入。

### 合并判断

P6 stale carry 与 P7 same-day refresh carry **都被真实数据否掉**。当前证据下：

- “carry + 原始 3F”没有独立 alpha；
- “carry + CarryRefreshV1”会改变 fresh 侧选股，且改变本身是负面的；
- 在现有数据域内，**控制臂 top3 / 2 笔 / 5 仓 + Runner T74 仍是最优**。

下一步若还要继续，不应再在 carry 上换评分权重；需要寻找与当前 3F **低相关且有正 IC** 的新信息源，并先单独验证该信息源，而不是直接混入选股。
