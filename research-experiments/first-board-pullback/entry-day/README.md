# 示例实验 · 首板回踩 · 入场日基础统计

`pageKey` = `first-board-pullback/entry-day` · 计算口径版本 `1.0.0`

## 研究问题

首板（首个涨停）之后，**在第 T+k 个交易日开盘入场、持有到第 T+exit 个交易日收盘**，
不同 k 的基础统计差多少？

## 口径（逐项可复核）

| 量 | 定义 | 数据来源 |
| --- | --- | --- |
| 基准价 | 首板日（rd=0）收盘 `close` | `ds_first_limit_pullback_prefix`（PIT 安全） |
| 入场价 | 入场日（rd=k）开盘 `open` | `ds_first_limit_pullback_post` |
| 退出价 | 退出日（rd=exit）收盘 `close` | `ds_first_limit_pullback_post` |
| 入场位置 | `(入场价 / 基准价 − 1) × 100`（%），负 = 低开 | 派生 |
| 持有收益 | `(退出价 / 入场价 − 1) × 100`（%） | 派生 |
| 最大不利偏移 | 入场日（含当日）到退出日之间最低 `low` 相对入场价（%） | 派生 |
| 胜率 | 分组内「持有收益 > 0」的样本占比 | 派生 |

**样本单位** =（事件 × 入场日）一次可评估的入场机会。默认参数：
`entryDays=[1,2,3,4,5]`、`exitRelativeDay=5`、`maxEvents=2000`。

> `entryDay === exitRelativeDay` 是**合法**的（当日开盘买入、当日收盘卖出）；
> 只有 `entryDay > exitRelativeDay` 才被拒绝（没有任何持有期）。
> 最大不利偏移**含入场日当日** —— 否则该入场日的区间为空、指标恒为「无数据」。

## 参数

| code | 类型 | 默认 | 边界 |
| --- | --- | --- | --- |
| `entryDays` | INT_LIST | `[1,2,3,4,5]` | 元素 ∈ [1, 20] |
| `exitRelativeDay` | INT | `5` | [1, 20]，且必须 > 所有入场日 |
| `maxEvents` | INT | `2000` | [10, 20000] |

## Dataset 声明

- `datasetCode = first_limit_pullback`
- `prefixRelativeDays = [0]`；`postRelativeDays = [1..20]`
- `requiredColumns`：events `[isFirstLimit, boardType, previousClose]`、
  feature `[close]`、observation `[open, high, low, close]`
- `usesForwardData = true`（**必须**：研究的就是事件日之后的收益），
  `decisionOffsetDays = null`（样本资格不使用事件日之后的价格条件）
- 实际读取的 post 相对日是「1..exitRelativeDay」的子集，由参数决定

## 已知偏差（不藏）

1. **数据可得性选择偏差**：样本资格要求 T+k 与 T+exit 的行情都存在。
   临近数据集末端的事件会因行情不全被剔除，这是**数据可得性**条件而非价格条件，
   已计入剔除原因并在结果 `selectionNotes` 里登记。
2. **持有期不等长**：退出日固定为 T+exit，因此越晚的入场日持有期越短 ——
   跨入场日比较时必须记住这一点。
3. **`maxEvents` 截断**：超出上限的事件逐条登记 `MAX_EVENTS_LIMIT`，不静默丢弃。

## 本实验刻意**不**做什么

- 不排序、不评级、**不给「最佳入场日」**。同一份数据里挑平均收益最高的入场日
  等价于做了一次样本内参数选择，换个窗口很可能不成立；要谈优劣必须先有样本外验证。
- 不产出任何信号 / 参数 / 策略结论。

## 怎么跑

1. 打开左侧栏「研究 → **独立实验**」（`/research-experiments`）；
2. 点开「首板后入场日基础统计」；
3. 选择 Dataset 版本（`first_limit_pullback` 的 READY 版本）；
4. 点「运行」。

结果**不落库**（本体系零新表，执行是请求内计算），刷新后需要重跑；
但 Dataset 坐标存在 URL（`?datasetVersionId=…`）里，不会丢。
