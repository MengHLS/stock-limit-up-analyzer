# 首板后收盘守涨停价研究

## 研究问题

首板日之后，`T+1..T+5` 的每日收盘价相对 `T日涨停价` 处于什么位置，是否与
`T+6` 开盘入场后的 `T+10/T+15/T+20` 收益有关？

## 固定口径

- 事件：`first_limit_pullback` Dataset 中 `isFirstLimit=true`、沪深主板、数据构建阶段已排除 ST。
- 信息边界：分组只使用 `T+1..T+5` 收盘信息；`T+5` 收盘后决策，最早 `T+6` 开盘入场。
- 分组：
  - `AT_OR_ABOVE`：`min(close[T+1..T+5]) >= limitUpPrice(T)`。
  - `SLIGHT_BREACH`：最低收盘跌破涨停价，但幅度不超过 `slightBreachBps`，默认 `200 bps`。
  - `DEEP_BREACH`：最低收盘跌破涨停价超过 `slightBreachBps`。
- 退出：`T+10/T+15/T+20` 收盘；收益为 `exitClose / T+6 open - 1`。
- 成本：默认扣除 `20 bps` 往返成本敏感性参数。
- 统计：按交易日聚类的 Moving Block Bootstrap，默认 `1000` 次、`block=20` 个交易日。
- 一字板：默认排除首板日 `O=H=L=C=limitUpPrice` 的事件，可通过参数关闭。

## 已知偏差

- 只检查收盘价，不模拟 `T+1..T+5` 盘中是否跌破涨停价。
- 未实现涨跌停排队、部分成交、滑点、整手、公司行为或破位后止损撮合。
- Bootstrap 只处理同期事件相关性和重叠收益窗口，不等于独立 Holdout。
- `200 bps` 是预先固定的研究阈值，不对它做参数寻优。

## 刻意不做什么

- 不输出最优阈值、最优持有期、策略对象或买入评级。
- 不把当前 Dataset 的样本内差异声称为 OOS 通过。
- 不修改已存在的 Dataset 版本或旧 Run。
