# P3-T4 验收 — 回测边界条件全验证

> 状态：CODE_READY | 日期：2026-09-09

## 验收标准（MASTER_PRODUCT_ROADMAP）

> 边界条件逐项真实数据断言通过（T+1 / 涨跌停 / 停牌 / 滑点 / 费用 / 资金 / 退出 / 止损 / 止盈 / 公司行为）。

诚实口径：本任务用 **synthetic fixture 逐项断言引擎边界逻辑**（`server/engine/edgeCases.test.ts`，18 用例），
对已覆盖项逐项 PASS；对引擎**尚未实现**的项显式标注 **KNOWN_GAP**（不冒充覆盖）。
「真实数据断言」留待 P5-T1 Baseline Backtest（铁律 CODE_READY ≠ VALIDATED）。

## 边界条件逐项结果

| # | 边界条件 | 状态 | 证据 | 说明 |
|---|---------|------|------|------|
| 1 | T+1（信号 T 收盘 → T+1 开盘成交） | ✅ 覆盖 | engine.test.ts / edgeCases | 引擎事件循环「收盘产信号 → 次交易日开盘成交」 |
| 2 | 涨跌停可成交性（blockLimitUpBuy / blockLimitDownSell） | ✅ 覆盖 | edgeCases.test.ts | Execution 层支持可配置拦截；默认不拦截 |
| 3 | 停牌 / 数据缺失 | ✅ 覆盖 | edgeCases.test.ts | 成交日无 bar → 信号作废，不产生持仓/强平 |
| 4 | 板块涨跌停幅度（主板10%/ST5%/创业+科创20%/北交所30%） | ✅ 覆盖 | edgeCases.test.ts | boardRules.resolveLimitRules 纯函数验证 |
| 5 | 滑点（买上浮/卖下浮 + 流动性分层） | ✅ 覆盖 | engine.test.ts / engine.fix.test.ts | 未来函数防护已锁 |
| 6 | 费用（佣金最低5/印花税仅卖出/过户费双边） | ✅ 覆盖 | edgeCases.test.ts | 印花税单向性断言 |
| 7 | 资金（现金不足向下取整到整手） | ✅ 覆盖 | engine.test.ts / engine.fix.test.ts | 约束顺序 + 不变量 |
| 8 | 退出（maxHoldingDays 时间退出 + hold-while-selected 信号退出） | ✅ 覆盖 | edgeCases.test.ts + P3-T1 | 端到端锁定 entry/exit 时序 |
| 9 | 止损 / 止盈 | ❌ **KNOWN_GAP K1** | 见下 | 生产引擎无，待 P4-T1 定义策略规则 |
| 10 | 公司行为 / 除权除息 | ❌ **KNOWN_GAP K2** | 见下 | 引擎未接入 adjustment_factors 复权 |
| 11 | 一字板封死概率 | ❌ **KNOWN_GAP K3** | 见下 | 仅 legacy 有 enableOneWordLimitDownProbability |
| 12 | 板块 limitRules 注入生产引擎 | ❌ **KNOWN_GAP K4** | 见下 | 引擎用默认 10%，未按 symbol 注入 resolveLimitRules |

## KNOWN_GAP 明细

- **K1 止损/止盈**：生产引擎退出仅 hold-while-selected + maxHoldingDays。legacy `riskManagedHold`
  （stopLossPercent / trailingDrawdownPercent / trailingProfitActivationPercent / strongHoldMinReturn）
  在生产引擎不消费。**待 P4-T1 用户定义 FIRST_FORMAL_STRATEGY 的止损止盈规则后接入**（铁律：不擅自发明规则）。
- **K2 公司行为/除权**：`adjustment_factors`（31,337 行）已 FULL 回填，但生产引擎 Core 直接消费 rawRows 未复权价格，
  除权日会算出假盈亏。需在数据进引擎前按前复权口径调整。
- **K3 一字板封死概率**：legacy `enableOneWordLimitDownProbability`（跌停封死无法卖出概率模型）生产引擎无。
- **K4 板块 limitRules 未注入**：`strategyBacktest.runStrategyEngineBacktest` 用默认 `nextOpenExecutionModel()`
  （固定 10%），未按 symbol 注入 `boardRules.resolveLimitRules`（板块差异已实现但未接线），也未启用
  blockLimitUpBuy / blockLimitDownSell 开关。

## 附带发现（P3-T1 遗留项确认）

`portfolio.sell` 清仓时 `trade.reason` 硬编码 `null`（退出原因未传递到 Trade）——本任务确认，
留待接入止损/止盈退出（K1）时一并把 `reason`（"持有满N日"/"断板退出"/"止损"/"止盈"）贯通到 Trade。

## 验证

- `tsc --noEmit` 无错误。
- `server/engine/edgeCases.test.ts`（18）+ `server/engine/*`（63）+ `server/strategy/*`（54）= 117 测试全绿。
