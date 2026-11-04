# composite-runner-newhigh3-t74-event-gate（P9 · 事件事实 gate）

## 目标

不改变 T74 原策略的 3F 排序、top3、退出链和 Runner，只在“是否新开仓”上加事件事实 gate：

- daysSincePreviousLimit：距上次涨停天数，越低越好；
- turnover：首板日成交额，越低越好；
- historicalLimitCount：历史涨停次数，弱正向探索。

阈值只用 2019-01-02..2024-12-31 训练段计算，OOS 不重估。

## 臂

| 臂 | gate |
| --- | --- |
| control | 无 |
| gap-p50 | daysSincePreviousLimit <= 训练 p50 |
| gap-p33 | daysSincePreviousLimit <= 训练 p33 |
| turnover-p50 | turnover <= 训练 p50 |
| combo-p50 | gap + turnover 均 <= 训练 p50 |
| histlimit-p67 | historicalLimitCount >= 训练 p67 |

## 冻结项

- original top3 不变；
- 不补 rank4/5；
- 3F 排序、Runner NEW_HIGH_3/5/74、SL-18.1、maxDailyBuys=2、maxPositions=5、成本和数据坐标全部冻结。

## 当前状态

待真实 Run。

## 当前状态（2026-10-05 · EXPLORATORY 真实 Run）

真实 Run：RUN-20261005-8668C385（datasetVersionId 780001，COMPLETED，约 161 s；控制臂 parity PASS）。

| 臂 | C 收益 | C 最大回撤 | C 成交 | >=+50% | >=+100% | 过滤 intent | 保留 intent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| control | **151.10%** | **43.30%** | 1434 | **9** | 2 | 0 | 0 |
| gap-p50 | 38.06% | 56.76% | 1366 | 8 | 1 | 2918 | 2651 |
| gap-p33 | 76.88% | 48.63% | 1203 | 9 | 1 | 3776 | 1793 |
| turnover-p50 | **165.74%** | 49.44% | 1273 | 7 | 1 | 2902 | 2667 |
| combo-p50 | 43.93% | **37.09%** | 893 | 3 | 1 | 4457 | 1112 |
| histlimit-p67 | −41.00% | 68.26% | 1066 | 5 | 1 | 3121 | 2448 |

### 结论：P9 REJECTED

- 没有任何一条 gate 增加实现 >=+50% 的笔数；control 仍是 9，turnover-p50 反而降到 7；
- turnover-p50 收益 +14.64 pp，但代价是最大回撤 43.30% → 49.44%、>=+50% 9 → 7，不符合“抓更多超级票”的目标；
- combo-p50 虽然把回撤降到 37.09%，但收益从 151.10% 降到 43.93%、>=+50% 降到 3；
- gap / histlimit gate 更差。事件事实只能做弱过滤，不能作为新的 alpha 来源。

### 合并判断

P6 stale carry、P7 当日重评分、P8 延迟入场、P9 事件事实 gate 全部被真实数据否掉。当前控制臂 T+5 选股 / T+6 买入 + Runner T74 仍是最优；后续需要外部补数（资金流/龙虎榜/北向/基本面）才可能引入真正的新信息源。
