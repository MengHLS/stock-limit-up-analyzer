# 单因子研究通用模板 V1（`first-board-pullback/single-factor-v1`）

> 模板编号 **`SINGLE_FACTOR_EXPERIMENT_V1`** · 实验契约 **`SF-V1-001`** ·
> 通用基础在 **`research-experiments/shared/singleFactor/`**（见那里的 README）。

## 这个实验回答什么

「把**某一个**因子当成每日横截面排序键，取头部（HIGH）或尾部（LOW）的 N 名，
相对**当日全部候选**有没有超额？」

## 为什么是「一个实验 + 一个因子参数」

需求是「后续 12 个现有因子及新增因子全部复用该模板，不再为单个因子单独开发实验逻辑」。
因此 `run()` 只有四步，换因子只改参数：

```ts
run({ parameters: { factorCode: "turnover" } });   // 跑换手率
run({ parameters: { factorCode: "holdStreak" } }); // 同一段代码，零改动
```

🔴 **方向（HIGH/LOW）与 TopN（3/5/10/20）刻意不是参数**：它们是静态常量，
一次 Run 把 **8 个预定义组合全部**输出。若做成参数，「跑 8 次挑最好的那次」
就成了可操作动作，而那正是需求明令禁止的事后择优。

## 冻结口径

```
experimentType = SINGLE_FACTOR      Universe = 首板回踩候选池（= 12F 入池池）
T              = 首板日（rd = 0）    Observation = T+1 ~ T+5（观察窗，不是买入窗）
Signal         = T+5 收盘（信息截止） Entry = T+6 开盘（canBuyAtOpen）
Exit           = T+10 收盘（canSellAtClose；不可卖顺延到其后第一个可卖日，≤ T+20）
Position       = 全仓等权            Cost = 往返 20 bps
Ranking        = HIGH / LOW          TopN = 3 / 5 / 10 / 20
Benchmark      = 当日全部符合条件的候选股票（等权）
```

入场/退出/成本与 `FROZEN-BUCKET-CONTRACT-001` 冻结坐标**逐字一致**
（`assertTemplateCoordinate()` 每次 Run 开头断言），因此本实验的数字与
`twelve-factor-composite-study` / `twelve-factor-topn-ranking-study` **逐笔可比**。

## 结果结构

| 需求项 | 落点 |
| --- | --- |
| Experiment Definition | 表 `sf_experiment_definition` |
| Overall Result | 表 `sf_overall_result`（8 组合 × 11 个核心指标） |
| TopN Result | 表 `sf_topn_result` |
| Benchmark Result | 表 `sf_benchmark_result` |
| Excess Return | 表 `sf_excess_result`（主判据：配对日度超额 + Bootstrap CI + 三态判定） |
| Time Slice Result | 表 `sf_time_slice_result`（决策日自然年切片） |
| Trade Details | 表 `sf_trade_details`（每组合前 50 笔）+ CSV 产物（全量 `trades/single-factor-<factor>.csv.gz`） |
| 附加 | `sf_sample_flow` / `sf_factor_contract` / `sf_day_diagnostics` |

核心指标（`totalReturn` / `meanTradeReturn` / `medianTradeReturn` / `winRate` /
`profitFactor` / `maxDrawdown` / `tradeCount` / `benchmarkReturn` / `excessReturn` /
`averageHoldingDays` / `cost` 与 `slippage`）全部落在 `sf_overall_result` 与
`customPayload.combos[].metrics`。
逐笔字段：`stockCode` / `factorValue` / `rank` / `signalDate` / `entryDate` /
`entryPrice` / `exitDate` / `exitPrice` / `holdingDays` / `grossReturn` / `cost` / `netReturn`
（另有 `decisionDate` / `poolSize` / `exitRelativeDay` / `costBps` / `eventId` 便于复核）。

## 刻意不做

- ❌ 组合因子（每个 Run 只允许一个因子，结构上无法传入第二个）；
- ❌ Parameter Search（除 `factorCode` 外无任何可调参数）；
- ❌ 策略开发（不产 `StrategyDefinition`、不写 strategy 表）；
- ❌ OOS / Holdout（`researchPhase = EXPLORATORY`）；
- ❌ 事后择优（8 个组合全部落进结果，无「只保留最优」的开关）；
- ❌ 改动因子定义与冻结分桶（全部 `import` 自 `twelve-factor-composite-study/result.ts`）。

## 读结果时的三个提醒

1. **观察窗不是买入窗**：`T+1~T+5` 只提供信息，最早合法成交点是 `T+6` 开盘。
2. **基准不是指数**：基准 = 当日候选池等权；随机抽 N 只的期望恒等于它，
   所以「正超额」=「平均意义上优于随机抽签」，不是跑赢大盘。
3. **池子口径**：池 = 12F 入池池（要求 12 个因子全部可评估）⇒ 目标因子之外的因子
   缺失也会减少样本。这是为了让 12 个单因子实验跑在同一份样本上，可横向比较。
